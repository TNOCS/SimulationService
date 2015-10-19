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
 * Electrical Network Simulator.
 *
 * It listens to floodings: when a flooding occurs, all power substations are checked, and, if flooded,
 * fail to perform their function.
 * Also, in case their dependencies are no longer satisfied, e.g. when (all of) their power supplying
 * substation fails, it will fail too.
 */
export class ElectricalNetworkSim extends SimSvc.SimServiceManager {
    /** Relative folder for the original source files */
    private relativeSourceFolder = 'source';
    /** Simulation start time */
    private simStartTime: Date;
    private powerStations: Api.ILayer;

    constructor(namespace: string, name: string, public isClient = false, public options: Api.IApiManagerOptions = <Api.IApiManagerOptions>{}) {
        super(namespace, name, isClient, options);
    }

    start() {
        super.start();

        this.initFSM();
        this.reset();
    }

    /**
     * Initialize the FSM, basically setting the simulation start time.
     */
    private initFSM() {
        // Specify the behaviour of the sim.
        this.fsm.onEnter(SimSvc.SimState.Ready, (from) => {
            if (from === SimSvc.SimState.Idle) this.simStartTime = this.simTime;
            return true;
        });

        this.fsm.onEnter(SimSvc.SimState.Idle, (from) => {
            this.reset();
            this.message = 'Network has been reset.'
            return true;
        });

        this.subscribeKey(`cs.layers.floodsim`, <Api.ApiMeta>{}, (topic: string, message: any, params: Object) => {
            Winston.info('Floodsim key received');
        });
    }

    /** Reset the state to the original state. */
    private reset() {
        // Copy original GeoJSON layers to dynamic layers
        var sourceFolder = path.join(this.rootPath, this.relativeSourceFolder);

        var stationsFile = path.join(sourceFolder, 'power_stations.json');
        fs.readFile(stationsFile, (err, data) => {
            if (err) {
                Winston.error(`Error reading ${stationsFile}: ${err}`);
                return;
            }
            let ps = JSON.parse(data.toString());
            this.powerStations = this.createNewLayer('powerstations','Stroomstations', ps.features, 'Elektrische stroomstations');
            this.clearAllStates(this.powerStations.features);
            this.publishLayer(this.powerStations);
        });
    }

    /** Set the state of a feature */
    private setFeatureState(feature: Api.Feature, state: SimSvc.InfrastructureState) {
        feature.properties['state'] = state; //SimSvc.InfrastructureState[state];
    }

    /** Clear (reset) all feature states to OK */
    private clearAllStates(features: Api.Feature[]) {
        features.forEach(f => {
            this.setFeatureState(f, SimSvc.InfrastructureState.Ok);
        });
    }

    private createNewLayer(id: string, title: string, features: Api.Feature[], description?: string) {
        var layer: Api.ILayer = {
            server: this.options.server,
            id: id,
            title: title,
            description: description,
            features: features,
            storage: 'file',
            enabled: true,
            isDynamic: true,
            typeUrl: `${this.options.server}/api/resources/electrical_network`,
            type: 'dynamicgeojson',
        }
        return layer;
    }

    /**
     * Create and publish the layer.
     */
    private publishLayer(layer: Api.ILayer) {
        this.addUpdateLayer(layer, <Api.ApiMeta>{}, () => { });
    }

}
