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
 * Flooding Simulator.
 *
 * FloodSim does not calculate a flooding, but listens for flooding start events (at a certain time and location),
 * and from then on publishes the water depth.
 *
 * FloodSim is fed with a number of scenarios, i.e. known flooding simulations consisting of a sequence of
 * raster files which contain the maximum water depth for a certain breach location at a certain time
 * (defined from the start of the flooding).
 *
 * Each scenario has its own folder in the 'data/flooding' folder. The folder contains files, where the filename of
 * each file is the time in minutes since the flooding started.
 *
 * Based on the received trigger, it will publish a selected scenario.
 *
 * TOOD
 * Add a REST interface to inform others what kinds of keys / messages you expect, and what you need.
 */
export class FloodSim extends SimSvc.SimServiceManager {
    /** Relative folder for the scenarios */
    private relativeScenarioFolder = 'scenarios';
    /** Base folder for the scenarios */
    private scenarioFolder = 'scenarios';
    /** If true, the flooding has started */
    private floodingHasStarted = false;
    /** A list of available flood simulations, i.e. floodSims[scenarioName] = { timeStamp, layer } */
    private floodSims: {
        [scenarioName: string]: {
            /** The time in minutes since the start of the simulation */
            timeStamp: number,
            /** The reference to the flooding data: the actual data still needs to be loaded */
            layer: Api.ILayer
        }[]
    } = {};
    /** The published flooding scenario, time and layer */
    private pubFloodingScenario: {
        scenario: string,
        timeStamp: number,
        /** Time that the flooding started */
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

        this.publishFloodLayer();
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

        this.subscribeKey('sim.floodSimCmd', <Api.ApiMeta>{}, (topic: string, message: string, params: Object) => {
            Winston.info(`Topic: ${topic}, Msg: ${JSON.stringify(message, null, 2)}, Params: ${params ? JSON.stringify(params, null, 2) : '-'}.`)
            if (message.hasOwnProperty('scenario')) this.startScenario(message['scenario']);
            if (message.hasOwnProperty('next')) this.publishNextFloodLayer(Number.MAX_VALUE);
        });

        // When the simulation time is changed:
        // 1. Check if we have to publish a new Layer
        // 2. If there is a new layer, read the asc grid file and put it in the layer.data property
        this.on('simTimeChanged', () => {
            var scenario = this.pubFloodingScenario.scenario;
            if (!scenario) return;
            if (this.floodSims[scenario][this.floodSims[scenario].length-1].timeStamp === this.pubFloodingScenario.timeStamp) {
                this.message = `${scenario} scenario has ended.`;
                this.nextEvent = null;
                this.sendAck(this.fsm.currentState);
                return;
            }
            var minutesSinceStart = this.simTime.diffMinutes(this.pubFloodingScenario.startTime);
            this.publishNextFloodLayer(minutesSinceStart);
        });

    }

    /**
     * Create and publish the flood layer.
     */
    private publishFloodLayer() {
        var layer = this.createNewFloodLayer(``, 'Initial flooding status.');
        this.pubFloodingScenario = {
            scenario: '',
            timeStamp: -1,
            startTime: null,
            layer: layer
        }
        this.addUpdateLayer(layer, <Api.ApiMeta>{}, () => { });
    }

    private createNewFloodLayer(file: string, description?: string) {
        var layer: Api.ILayer = {
            server: this.options.server,
            id: 'FloodSim',
            title: 'Flooding',
            description: description,
            features: [],
            storage: 'file',
            enabled: true,
            isDynamic: true,
            data: '',
            url: file,
            typeUrl: `${this.options.server}/api/resources/floodsimtypes`,
            type: 'grid',
            renderType: 'gridlayer',
            dataSourceParameters: <IsoLines.IGridDataSourceParameters>{
                propertyName: 'h',
                gridType: 'esri',
                projection: 'WGS84',
                legendStringFormat: '{0:0.00}m'
                //,contourLevels: [0.1, 0.5, 1, 3, 4, 5, 6]
            },
            defaultFeatureType: 'flooding',
            defaultLegendProperty: 'h'
        }
        return layer;
    }

    /**
     * Load all the scenarios and all flooding simulations.
     */
    private loadAllScenarioFiles() {
        // Read scenarios from the folder
        this.scenarioFolder = path.join(this.rootPath, this.relativeScenarioFolder);
        if (!fs.existsSync(this.scenarioFolder)) return;

        // Start loading all data
        var scenarios = Utils.getDirectories(this.scenarioFolder);
        scenarios.forEach(scenario => {
            var scenarioFolder = path.join(this.scenarioFolder, scenario);
            var files = fs.readdirSync(scenarioFolder);
            files.forEach(f => {
                var ext = path.extname(f);
                var file = path.join(scenarioFolder, f);
                if (ext !== '.asc') return;
                this.addToScenarios(scenario, file);
            });
        });
    }

    private addToScenarios(scenario: string, file: string) {
        var timeStamp = this.extractTimeStamp(path.basename(file));
        var layer = this.createNewFloodLayer(file, `Flooding ${scenario}: situation after ${timeStamp} minutes.`);
        if (!this.floodSims.hasOwnProperty(scenario)) this.floodSims[scenario] = [];
        this.floodSims[scenario].push({
            timeStamp: timeStamp,
            layer: layer
        });
        // Sort files on every insertion, so we process them in the right sequence too.
        this.floodSims[scenario].sort((a, b) => {
            return (a.timeStamp < b.timeStamp) ? -1 : 1;
        });
    }

    /** Publish the next available flooding layer. */
    private publishNextFloodLayer(minutesSinceStart: number) {
        var scenario = this.pubFloodingScenario.scenario;
        var publishedTimeStamp = this.pubFloodingScenario.timeStamp;
        this.fsm.trigger(SimSvc.SimCommand.Run);
        Winston.info(`Start time: ${this.pubFloodingScenario.startTime.toLocaleTimeString()}.`);
        Winston.info(`Current time: ${this.simTime.toLocaleTimeString()}.`);
        Winston.info(`Minutes since start: ${minutesSinceStart}.`);
        for (let i in this.floodSims[scenario]) {
            var s = this.floodSims[scenario][i];
            if (s.timeStamp <= publishedTimeStamp) continue;
            if (s.timeStamp > minutesSinceStart) {
                this.fsm.trigger(SimSvc.SimCommand.Finish);
                return;
            }
            this.pubFloodingScenario.timeStamp = s.timeStamp;
            let keys = Object.keys(this.floodSims[scenario]);
            let index = keys.indexOf(i);
            let nextFlood = this.floodSims[scenario][keys[index+1]];
            Winston.warn(`nextFlood: ${nextFlood.timeStamp}`);
            this.nextEvent = (nextFlood) ? (this.pubFloodingScenario.startTime.addMinutes(nextFlood.timeStamp)).getTime() : null;
            fs.readFile(s.layer.url, 'utf8', (err: NodeJS.ErrnoException, data: string) => {
                if (err) {
                    Winston.error(`Error reading file: ${err}.`);
                    this.fsm.trigger(SimSvc.SimCommand.Finish);
                    return;
                }
                this.message = `${scenario}: minute ${s.timeStamp}.`;
                Winston.info(`${this.message}.`);
                this.updateFloodLayer(s.timeStamp, data);
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
        this.floodingHasStarted = this.floodSims.hasOwnProperty(scenario);
        if (!this.floodingHasStarted) return;

        this.pubFloodingScenario.scenario = scenario;
        this.pubFloodingScenario.startTime = this.simTime;

        let s = this.floodSims[scenario][0];
        let d = this.pubFloodingScenario.startTime.addMinutes(s.timeStamp);
        this.nextEvent = d.getTime();

        this.message = `${scenario} loaded. Next event at ${d.toLocaleString()}`;
        Winston.info(`${this.message}.`);
    }

    /**
     * Update the published flood layer with new data.
     */
    private updateFloodLayer(timeStamp: number, data: string) {
        var layer: Api.ILayer = _.clone(this.pubFloodingScenario.layer);
        layer.data = data;
        layer.url = '';
        this.pubFloodingScenario.timeStamp = timeStamp;
        this.addUpdateLayer(layer, <Api.ApiMeta>{}, () => { });
    }

    private extractTimeStamp(filename: string) {
        var timeStamp: number;
        try {
            timeStamp = +filename.replace('.asc', '');
        } catch (e) {
            Winston.error(`Error reading timestamp from ${filename}. The filename should be a number (the number of minutes since the start of the simulation)!`);
            return;
        }
        return timeStamp;
    }
}
