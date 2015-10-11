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
    private floodingHasStarted = true;
    /** A list of available flood simulations, i.e. floodSims[scenarioName] = { timeStamp, layer } */
    private floodSims: {
        [scenarioName: string]: {
            /** The time in minutes since the start of the simulation */
            timeStamp: number,
            /** The reference to the flooding data: the actual data still needs to be loaded */
            layer: Api.Layer
        }[]
    } = {};
    /** The published flooding scenario, time and layer */
    private pubFloodingScenario: {
        scenario: string,
        timeStamp: number,
        /** Time that the flooding started */
        startTime: Date,
        layer: Api.Layer
    };
    /** Simulation start time */
    private simStartTime: Date;

    constructor(namespace: string, name: string, public isClient = false, public options: Api.IApiManagerOptions = <Api.IApiManagerOptions>{}) {
        super(namespace, name, isClient, options);
    }

    start() {
        super.start();

        this.initFSM();
        this.publishFloodLayer();
        this.loadAllScenarioFiles();
        this.waitForFloodSimCmds();
    }

    /**
     * Initialize the FSM, basically setting the simulation start time.
     */
    private initFSM() {
        // Specify the behaviour of the sim.
        this.fsm.onEnter(SimSvc.SimState.Ready, (from) => {
            if (from === SimSvc.SimState.Idle || from === SimSvc.SimState.Busy)
                this.simStartTime = this.simTime;
            return true;
        });
    }

    /**
     * Create and publish the flood layer.
     */
    private publishFloodLayer() {
        var layer = this.createNewFloodLayer('', 'Initial flooding status.');
        this.pubFloodingScenario = {
            scenario: '',
            timeStamp: -1,
            startTime: null,
            layer: layer
        }
        this.addUpdateLayer(layer, <Api.ApiMeta>{}, () => { });
    }

    private createNewFloodLayer(file: string, description?: string) {
        var layer = <Api.Layer>{
            server: this.options.server,
            id: 'FloodSim',
            title: 'Flooding',
            description: description,
            features: [],
            storage: 'file',
            enabled: true,
            url: file || `${this.options.server}/api/layers/floodsim`,
            typeUrl: `${this.options.server}/api/resources/floodsimtypes`,
            type: 'dynamicgeojson',
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
        this.fsm.trigger(SimSvc.SimCommand.Run);

        // Get all files
        var filesToProcess: { scenario: string, name: string, path: string }[] = [];
        var scenarios = Utils.getDirectories(this.scenarioFolder);
        scenarios.forEach(scenario => {
            var scenarioFile = path.join(this.scenarioFolder, scenario);
            var files = fs.readdirSync(scenarioFile);
            files.forEach(f => {
                var ext = path.extname(f);
                var file = path.join(scenarioFile, f);
                if (ext === '.geojson' || ext === '.json') {
                    this.addToScenarios(scenario, file);
                    return;
                }
                if (ext !== '.asc') return;
                // Check if we already have a converted version.
                var baseFile = f.replace('.asc', '');
                if (files.indexOf(baseFile + '.json') >= 0 || files.indexOf(baseFile + '.geojson') >= 0) return;
                filesToProcess.push({ scenario: scenario, name: f, path: file })
            });
        });
        // Read each file in parallel
        async.each(
            filesToProcess,
            (entry, cb) => {
                this.readFloodingFile(entry, () => cb());
            },
            (err) => {
                this.fsm.trigger(SimSvc.SimCommand.Finish);
                Winston.info('Finished processing flood files.');
                if (err) {
                    Winston.error('Error processing flood files: ' + err);
                }
            }
        );
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

    /**
     *	Listen to relevant KeyChanged events that can start the simulation.
     */
    private waitForFloodSimCmds() {
        this.subscribeKey('sim.floodSimCmd', <Api.ApiMeta>{}, (topic: string, message: string, params: Object) => {
            Winston.info(`Topic: ${topic}, Msg: ${JSON.stringify(message, null, 2)}, Params: ${params ? JSON.stringify(params, null, 2) : '-'}.`)
            this.startScenario('Gorinchem');
        });

        this.on('simTimeChanged', () => {
            var scenario = this.pubFloodingScenario.scenario;
            if (!scenario) return;
            this.fsm.trigger(SimSvc.SimCommand.Run);
            var publishedTimeStamp = this.pubFloodingScenario.timeStamp;
            var minutesSinceStart = this.simTime.diffMinutes(this.pubFloodingScenario.startTime);
            Winston.warn(`Start time: ${this.pubFloodingScenario.startTime.toLocaleTimeString()}.`);
            Winston.warn(`Current time: ${this.simTime.toLocaleTimeString()}.`);
            Winston.warn(`Minutes since start: ${minutesSinceStart}.`);
            for (let i in this.floodSims[scenario]) {
                var s = this.floodSims[scenario][i];
                if (s.timeStamp <= publishedTimeStamp) continue;
                if (s.timeStamp > minutesSinceStart) {
                    this.fsm.trigger(SimSvc.SimCommand.Finish);
                    return;
                }
                this.pubFloodingScenario.timeStamp = s.timeStamp;
                fs.readFile(s.layer.url, 'utf8', (err: NodeJS.ErrnoException, data: string) => {
                    if (err) {
                        Winston.error(`Error reading file: ${err}.`);
                        this.fsm.trigger(SimSvc.SimCommand.Finish);
                        return;
                    }
                    this.message = `The ${scenario} scenario is loaded: Processed minute ${s.timeStamp}.`;
                    Winston.info(`${this.message}.`);
                    var geojson = JSON.parse(data);
                    var copy = _.clone(s);
                    copy.layer.features = geojson.features;
                    // copy.layer.id = 'FloodSim';
                    this.updateFloodLayer(copy.timeStamp, copy.layer);
                    this.fsm.trigger(SimSvc.SimCommand.Finish);
                });
                return;
            }
        });
    }

    /**
     * Check whether the requested scenario exists, and start it.
     */
    private startScenario(scenario: string) {
        this.floodingHasStarted = this.floodSims.hasOwnProperty(scenario);
        if (!this.floodingHasStarted) return;

        this.message = `The ${scenario} scenario is loaded. Waiting for time events.`;
        Winston.info(`${this.message}.`);

        this.pubFloodingScenario.scenario = scenario;
        this.pubFloodingScenario.startTime = this.simTime;
    }

    /**
     * Update the published flood layer with new data.
     */
    private updateFloodLayer(timeStamp: number, newLayer: Api.Layer) {
        this.pubFloodingScenario.layer = newLayer;
        this.pubFloodingScenario.timeStamp = timeStamp;
        this.addUpdateLayer(this.pubFloodingScenario.layer, <Api.ApiMeta>{}, () => { });
    }

    private extractTimeStamp(filename: string) {
        var timeStamp: number;
        try {
            timeStamp = +filename.replace('.asc', '').replace('.json', '').replace('.geojson', '');
        } catch (e) {
            Winston.error(`Error reading timestamp from ${filename}. The filename should be a number (the number of minutes since the start of the simulation)!`);
            return;
        }
        return timeStamp;
    }

    /** Read a flooding file. Currently, only ESRI ASCII GRID files in RD are supported */
    private readFloodingFile(entry: { scenario: string, name: string, path: string }, callback: () => void) {
        fs.readFile(entry.path, 'utf8', (err: Error, data: Buffer) => {
            if (err) {
                Winston.error(`Error reading file ${entry.path}: ${err.message}`);
            } else {
                var params: IsoLines.IGridDataSourceParameters = <IsoLines.IGridDataSourceParameters>{
                    propertyName: 'h',
                    gridType: 'esri',
                    projection: 'RD',
                    noDataValue: -9999,
                    useContour: true,
                    minThreshold: 0,
                    contourLevels: [0.1, 0.5, 1, 3, 4, 5, 6]
                };
                var timeStamp = this.extractTimeStamp(entry.name);
                Winston.info(`Converting ${entry.path}...`);
                var floodSim = IsoLines.IsoLines.convertDataToIsoLines(data.toString(), params);
                Winston.info(`Done converting ${entry.path}: ${floodSim.features.length} features found.`);
                var outputFile = entry.path.replace('.asc', '.geojson');
                fs.writeFileSync(outputFile, JSON.stringify(floodSim, (key, value) => {
                    if (isNaN(+key)) return value;
                    return value.toFixed ? Number(value.toFixed(7)) : value;
                }));
                this.addToScenarios(entry.scenario, outputFile);
                callback();
            }
        });
    }
}
