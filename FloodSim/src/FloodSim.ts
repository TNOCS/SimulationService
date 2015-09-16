import fs = require('fs');
import path = require('path');
import Winston = require('winston');
import GeoJSON = require('../../ServerComponents/helpers/GeoJSON')
import Utils = require('../../ServerComponents/helpers/Utils')
import IsoLines = require('../../ServerComponents/import/IsoLines')
import ApiManager = require('../../ServerComponents/api/ApiManager');
import TypeState = require('../../SimulationService/state/typestate');
import SimulationService = require('../../SimulationService/api/SimServiceManager');

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
 */
export class FloodSim extends SimulationService.SimServiceManager {
    /** Relative folder for the scenarios */
    private relativeScenarioFolder = 'scenarios';
    /** Base folder for the scenarios */
    private scenarioFolder = 'scenarios';
    /** If true, the flooding has started */
    private floodingHasStarted: boolean = false;
    /** A list of available flood simulations, i.e. floodSims[scenarioName] = { timeStamp, layer } */
    private floodSims: {
        [scenarioName: string] : {
            /** The time in minutes since the start of the simulation */
            timeStamp: number,
            /** The flooding data */
            layer: ApiManager.Layer
        }[]
    } = {};
    /** The published flooding layer */
    private floodLayer: GeoJSON.IGeoJson;
    /** Simulation start time */
    private simStartTime: Date;
    /** Time that the flooding started */
    private floodingStartTime: Date;

    constructor(name: string, public isClient = false) {
        super(name, isClient);
    }

    loadConfiguration() {
        this.scenarioFolder = path.join(this.rootPath, this.relativeScenarioFolder);
        if (!fs.existsSync(this.scenarioFolder)) return;
        var scenarios = Utils.getDirectories(this.scenarioFolder);
        scenarios.forEach(scenario => {
            fs.readdir(path.join(this.scenarioFolder, scenario), (err: Error, files: string[]) => {
                if (err || typeof files === 'undefined') return;
                files.forEach(f => this.readFloodingFile(path.join(this.scenarioFolder, scenario, f), scenario));
            });
        });

        // fs.readFile(path.join(this.rootPath, 'Gorinchem_AW389_TP+1D.asc'), 'utf8', (err: Error, data: Buffer) => {
        //     if (err) {
        //         Winston.error('Cannot load flooding data: ' + err.message);
        //         return;
        //     }
        //     var params: IsoLines.IGridDataSourceParameters = <IsoLines.IGridDataSourceParameters>{
        //         propertyName: 'h',
        //         gridType: 'esri',
        //         projection: 'RD',
        //         noDataValue: -9999,
        //         useContour: true,
        //         minThreshold: 0,
        //         contourLevels: [1, 2, 3, 4, 5, 6]
        //     }
        //     this.floodLayer = IsoLines.IsoLines.convertDataToIsoLines(data.toString(), params);
        //     var layer = new ApiManager.Layer();
        //     layer.id = this.floodLayer.id;
        //     layer.title = 'Flooding simulation';
        //     layer.description = 'A simple flooding simulation.';
        //     layer.features = this.floodLayer.features;
        //     layer.storage = 'file';
        //     this.addLayer(layer, <ApiManager.ApiMeta>{}, () => { });
        // });

        this.fsm.onEnter(SimulationService.SimulationState.Ready, (from) => {
            if (from === SimulationService.SimulationState.Idle) this.simStartTime = this.simTime;
            this.on('simTimeChanged', () => {

            });
            return true;
        });

        this.fsm.onExit(SimulationService.SimulationState.Ready, () => {
            return true;
        });
    }

    /** Read a flooding file. Currently, only ESRI ASCII GRID files in RD are supported */
    private readFloodingFile(file: string, scenario: string) {
        if (path.extname(file) !== '.asc') return;
        fs.readFile(file, 'utf8', (err: Error, data: Buffer) => {
            if (err) {
                Winston.error(`Error reading file ${file}: ${err.message}`);
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
                    timeStamp = +path.basename(file, '.asc');
                } catch (e) {
                    Winston.error(`Error reading timestamp from ${file}. The filename should be a number (the number of minutes since the start of the simulation)!`);
                    return;
                }
                var floodSim = IsoLines.IsoLines.convertDataToIsoLines(data.toString(), params);
                var layer = new ApiManager.Layer();
                layer.features = floodSim.features;
                layer.storage = 'file';

                if (!this.floodSims.hasOwnProperty(scenario)) this.floodSims[scenario] = [];
                this.floodSims[scenario].push({
                    timeStamp: timeStamp,
                    layer: layer
                })
            }
        });
    }
}
