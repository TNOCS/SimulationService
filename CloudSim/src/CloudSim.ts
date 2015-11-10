import fs = require('fs');
import path = require('path');
import Winston = require('winston');
import async = require('async');
import GeoJSON = require('../../ServerComponents/helpers/GeoJSON')
import Utils = require('../../ServerComponents/helpers/Utils')
import IsoLines = require('../../ServerComponents/import/IsoLines')
import Api = require('../../ServerComponents/api/ApiManager');
import TypeState = require('../../SimulationService/state/typestate');
import SimSvc = require('../../SimulationService/api/SimServiceManager');
import _ = require('underscore');

/**
 * Gas cloud Simulator.
 *
 * Does not calculate a gas cloud, but listens for gas cloud start events (at a certain time and location),
 * and from then on publishes the gas concentration.
 *
 * CloudSim is fed with a number of scenarios, i.e. known gas cloud simulations consisting of a sequence of
 * raster files which contain the gas concentration water depth for a certain event location at a certain time
 * (defined from the start of the gas cloud).
 *
 * Each scenario has its own folder in the 'data/clouds' folder. The folder contains files, where the filename of
 * each file is the time in seconds since the cloud started.
 *
 * Based on the received trigger, it will publish a selected scenario.
 *
 * TOOD
 * Add a REST interface to inform others what kinds of keys / messages you expect, and what you need.
 */
export class CloudSim extends SimSvc.SimServiceManager {
    /** Relative folder for the scenarios */
    private relativeScenarioFolder = 'scenarios';
    /** Base folder for the scenarios */
    private scenarioFolder = 'scenarios';
    /** If true, the clouding has started */
    private cloudHasStarted = false;
    /** A list of available cloud simulations, i.e. cloudSims[scenarioName] = { timeStamp, layer } */
    private cloudSims: {
        [scenarioName: string]: {
            /** The time in seconds since the start of the simulation */
            timeStamp: number,
            /** The reference to the cloud data: the actual data still needs to be loaded */
            layer: Api.ILayer
        }[]
    } = {};
    /** The published cloud scenario, time and layer */
    private pubCloudScenario: {
        scenario: string,
        timeStamp: number,
        /** Time that the clouding started */
        startTime: Date,
        layer: Api.ILayer
    };

    constructor(namespace: string, name: string, public isClient = false, public options: Api.IApiManagerOptions = <Api.IApiManagerOptions>{}) {
        super(namespace, name, isClient, options);
    }

    start() {
        super.start();

        this.reset();
        this.initFSM();
        this.loadAllScenarioFiles();
    }

    private reset() {
        this.deleteFilesInFolder(path.join(__dirname, '../public/data/layers'));
        this.deleteFilesInFolder(path.join(__dirname, '../public/data/keys'));

        this.publishCloudLayer();
        this.fsm.currentState = SimSvc.SimState.Ready;
        this.sendAck(this.fsm.currentState);
    }

    /**
     * Initialize the FSM.
     */
    private initFSM() {
        this.fsm.onEnter(SimSvc.SimState.Idle, (from) => {
            this.message = 'Scenario has been reset.'
            this.reset();
            return true;
        });

        this.subscribeKey('sim.cloudSimCmd', <Api.ApiMeta>{}, (topic: string, message: string, params: Object) => {
            Winston.info(`Topic: ${topic}, Msg: ${JSON.stringify(message, null, 2) }, Params: ${params ? JSON.stringify(params, null, 2) : '-'}.`)
            if (message.hasOwnProperty('scenario')) this.startScenario(message['scenario']);
            if (message.hasOwnProperty('next')) this.publishNextCloudLayer(Number.MAX_VALUE);
        });

        // When the simulation time is changed:
        // 1. Check if we have to publish a new Layer
        // 2. If there is a new layer, read the asc grid file and put it in the layer.data property
        this.on('simTimeChanged', () => {
            var scenario = this.pubCloudScenario.scenario;
            if (!scenario) return;
            if (this.cloudSims[scenario][this.cloudSims[scenario].length - 1].timeStamp === this.pubCloudScenario.timeStamp) {
                this.message = `${scenario} scenario has ended.`;
                this.nextEvent = null;
                this.sendAck(this.fsm.currentState);
                return;
            }
            var secondsSinceStart = this.simTime.diffSeconds(this.pubCloudScenario.startTime);
            this.publishNextCloudLayer(secondsSinceStart);
        });

    }

    /**
     * Create and publish the cloud layer.
     */
    private publishCloudLayer() {
        var layer = this.createNewCloudLayer(``, 'Initial cloud status.');
        this.pubCloudScenario = {
            scenario: '',
            timeStamp: -1,
            startTime: null,
            layer: layer
        }
        this.addUpdateLayer(layer, <Api.ApiMeta>{}, () => { });
    }

    private createNewCloudLayer(file: string, description?: string) {
        var layer: Api.ILayer = {
            server: this.options.server,
            id: 'CloudSim',
            title: 'Cloud',
            description: description,
            features: [],
            storage: 'file',
            enabled: true,
            isDynamic: true,
            data: '',
            url: file,
            typeUrl: `${this.options.server}/api/resources/cloudsimtypes`,
            type: 'grid',
            renderType: 'gridlayer',
            dataSourceParameters: <IsoLines.IGridDataSourceParameters>{
                propertyName: 'c',
                gridType: 'esri',
                projection: 'WGS84',
                legendStringFormat: '{0:0.0000}mg/m3'
                //,contourLevels: [0.1, 0.5, 1, 3, 4, 5, 6]
            },
            defaultFeatureType: 'cloud',
            defaultLegendProperty: 'c'
        }
        return layer;
    }

    /**
     * Load all the scenarios and all cloud simulations.
     */
    private loadAllScenarioFiles() {
        var selectedHeight = 200;
        // Read scenarios from the folder
        this.scenarioFolder = path.join(this.rootPath, this.relativeScenarioFolder);
        if (!fs.existsSync(this.scenarioFolder)) return;

        // Start loading all data
        var scenarios = Utils.getDirectories(this.scenarioFolder);
        scenarios.forEach(scenario => {
            var scenarioFolder = path.join(this.scenarioFolder, scenario);
            var heightLevels = Utils.getDirectories(scenarioFolder);
            heightLevels.forEach(hl => {
                if (+hl !== selectedHeight) return;
                var heightFolder = path.join(this.scenarioFolder, scenario, hl);
                var files = fs.readdirSync(heightFolder);
                files.forEach(f => {
                    var ext = path.extname(f);
                    var file = path.join(heightFolder, f);
                    if (ext !== '.asc') return;
                    this.addToScenarios(scenario, file);
                });
            });
        });
    }

    private addToScenarios(scenario: string, file: string) {
        var timeStamp = this.extractTimeStamp(path.basename(file));
        var layer = this.createNewCloudLayer(file, `Cloud ${scenario}: situation after ${timeStamp} seconds.`);
        if (!this.cloudSims.hasOwnProperty(scenario)) this.cloudSims[scenario] = [];
        this.cloudSims[scenario].push({
            timeStamp: timeStamp,
            layer: layer
        });
        // Sort files on every insertion, so we process them in the right sequence too.
        this.cloudSims[scenario].sort((a, b) => {
            return (a.timeStamp < b.timeStamp) ? -1 : 1;
        });
    }

    /** Publish the next available clouding layer. */
    private publishNextCloudLayer(secondsSinceStart: number) {
        var scenario = this.pubCloudScenario.scenario;
        var publishedTimeStamp = this.pubCloudScenario.timeStamp;
        this.fsm.trigger(SimSvc.SimCommand.Run);
        Winston.info(`Start time: ${this.pubCloudScenario.startTime.toLocaleTimeString() }.`);
        Winston.info(`Current time: ${this.simTime.toLocaleTimeString() }.`);
        Winston.info(`Seconds since start: ${secondsSinceStart}.`);
        for (let i in this.cloudSims[scenario]) {
            var s = this.cloudSims[scenario][i];
            if (s.timeStamp <= publishedTimeStamp) continue;
            if (s.timeStamp > secondsSinceStart) {
                this.fsm.trigger(SimSvc.SimCommand.Finish);
                return;
            }
            this.pubCloudScenario.timeStamp = s.timeStamp;
            let keys = Object.keys(this.cloudSims[scenario]);
            let index = keys.indexOf(i);
            let nextCloud = this.cloudSims[scenario][keys[index + 1]];
            Winston.warn(`nextCloud: ${nextCloud.timeStamp}`);
            this.nextEvent = (nextCloud) ? (this.pubCloudScenario.startTime.addSeconds(nextCloud.timeStamp)).getTime() : null;
            fs.readFile(s.layer.url, 'utf8', (err: NodeJS.ErrnoException, data: string) => {
                if (err) {
                    Winston.error(`Error reading file: ${err}.`);
                    this.fsm.trigger(SimSvc.SimCommand.Finish);
                    return;
                }
                this.message = `${scenario}: seconds ${s.timeStamp}.`;
                Winston.info(`${this.message}.`);
                this.updateCloudLayer(s.timeStamp, data);
                this.fsm.trigger(SimSvc.SimCommand.Finish);
            });
            return;
        }
        this.fsm.trigger(SimSvc.SimCommand.Finish);
    }

    /**
     * Check whether the requested scenario exists, and start it.
     */
    private startScenario(scenario: string) {
        this.cloudHasStarted = this.cloudSims.hasOwnProperty(scenario);
        if (!this.cloudHasStarted) return;

        this.pubCloudScenario.scenario = scenario;
        this.pubCloudScenario.startTime = this.simTime;

        let s = this.cloudSims[scenario][0];
        let d = this.pubCloudScenario.startTime.addSeconds(s.timeStamp);
        this.nextEvent = d.getTime();

        this.message = `${scenario} loaded. Next event at ${d.toLocaleString() }`;
        Winston.info(`${this.message}.`);
    }

    /**
     * Update the published cloud layer with new data.
     */
    private updateCloudLayer(timeStamp: number, data: string) {
        var layer: Api.ILayer = _.clone(this.pubCloudScenario.layer);
        layer.data = data;
        layer.url = '';
        this.pubCloudScenario.timeStamp = timeStamp;
        this.addUpdateLayer(layer, <Api.ApiMeta>{}, () => { });
    }

    private extractTimeStamp(filename: string) {
        var timeStamp: number;
        try {
            timeStamp = +filename.replace('.asc', '');
        } catch (e) {
            Winston.error(`Error reading timestamp from ${filename}. The filename should be a number (the number of seconds since the start of the simulation)!`);
            return;
        }
        return timeStamp;
    }
}
