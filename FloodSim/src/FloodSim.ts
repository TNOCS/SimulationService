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
    /** Number of scenario files to read */
    private fileCounter = 0;
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
            /** The flooding data */
            layer: Api.Layer
        }[]
    } = {};
    /** The published flooding scenario, time and layer */
    private pubFloodingScenario: {
        scenario: string,
        timeStamp: number,
        layer: Api.Layer
    };
    /** Simulation start time */
    private simStartTime: Date;
    /** Time that the flooding started */
    private floodingStartTime: Date;

    constructor(name: string, public isClient = false) {
        super(name, isClient);
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
        this.fsm.onEnter(SimSvc.SimulationState.Ready, (from) => {
            if (from === SimSvc.SimulationState.Idle || from === SimSvc.SimulationState.Busy)
                this.simStartTime = this.simTime;
            return true;
        });
    }

    /**
     * Create and publish the flood layer.
     */
    private publishFloodLayer() {
        var layer = new Api.Layer();
        layer.id = 'FloodSim.' + Utils.newGuid();
        layer.title = 'Flooding';
        layer.description = 'Current flooding status.';
        layer.storage = 'file';
        layer.features = [];
        this.pubFloodingScenario = {
            scenario: '',
            timeStamp: -1,
            layer: layer
        }
        this.addLayer(layer, <Api.ApiMeta>{}, () => { });
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
            fs.readdir(scenarioFile, (err: Error, files: string[]) => {
                if (err || typeof files === 'undefined') return;
                files.forEach(f => {
                    if (path.extname(f) !== '.asc') return;
                    filesToProcess.push({ scenario: scenario, name: f, path: path.join(scenarioFile, f) })
                });
            });
        });
        // Read each file in parallel
        async.each(
            filesToProcess,
            (entry, cb) => this.readFloodingFile(entry),
            (err) => {
                if (err) {
                    Winston.error('Error processing flood files: ' + err);
                } else {
                    this.fsm.trigger(SimSvc.SimCommand.Finish);
                }
            }
        );
    }

    /**
     *	Listen to relevant KeyChanged events that can start the simulation.
     */
    private waitForFloodSimCmds() {
        this.on(Api.Event[Api.Event.KeyChanged], (key: Api.IChangeEvent) => {
            if (!key.value.hasOwnProperty('type') || key.value['type'] !== 'FloodSim') return;
            if (!key.value.hasOwnProperty('scenario')) return;
            var scenario = key.value['scenario'];
            this.startScenario(scenario);
        });
    }

    /**
     * Check whether the requested scenario exists, and start it.
     */
    private startScenario(scenario: string) {
        this.floodingHasStarted = this.floodSims.hasOwnProperty(scenario);
        if (!this.floodingHasStarted) return;

        this.pubFloodingScenario.scenario = scenario;

        this.on(SimSvc.Event[SimSvc.Event.TimeChanged], () => {
            var pubTimeStamp = this.pubFloodingScenario.timeStamp;
            this.floodSims[scenario].some(s => {
                if (s.timeStamp < pubTimeStamp || s.timeStamp < this.simTime.diffMinutes(this.floodingStartTime)) return false;
                this.pubFloodingScenario.timeStamp = s.timeStamp;
                this.pubFloodingScenario.layer = s.layer;
                this.updateFloodLayer(scenario, s.timeStamp, s.layer);
                return true;
            });
        });
    }

    /**
     * Update the published flood layer with new data.
     */
    private updateFloodLayer(scenario?: string, timeStamp?: number, newLayer?: Api.Layer) {
        if (!newLayer) {
        }
        if (!this.pubFloodingScenario) {
            // Initialize it for the first time.
        } else {
            // Update the layer data
            this.pubFloodingScenario = {
                scenario: scenario || '',
                timeStamp: timeStamp || 0,
                layer: newLayer
            }
        }
        this.updateLayer(this.pubFloodingScenario.layer, <Api.ApiMeta>{}, () => { });
    }

    /** Read a flooding file. Currently, only ESRI ASCII GRID files in RD are supported */
    private readFloodingFile(entry: { scenario: string, name: string, path: string }) {
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
                var timeStamp: number;
                try {
                    timeStamp = +path.basename(entry.name, '.asc');
                } catch (e) {
                    this.fileCounter--;
                    Winston.error(`Error reading timestamp from ${entry.path}. The filename should be a number (the number of minutes since the start of the simulation)!`);
                    return;
                }
                var floodSim = IsoLines.IsoLines.convertDataToIsoLines(data.toString(), params);
                var layer = new Api.Layer();
                layer.features = floodSim.features;
                layer.storage = 'file';

                if (!this.floodSims.hasOwnProperty(entry.scenario)) this.floodSims[entry.scenario] = [];
                this.floodSims[entry.scenario].push({
                    timeStamp: timeStamp,
                    layer: layer
                });
                this.fileCounter--;
                if (this.fileCounter === 0) this.emit('ProcessedAllFiles');
            }
        });
    }
}
