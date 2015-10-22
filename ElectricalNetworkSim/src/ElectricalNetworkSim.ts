import fs = require('fs');
import path = require('path');
import Winston = require('winston');
import async = require('async');
import GeoJSON = require('../../ServerComponents/helpers/GeoJSON')
//import TypeState = require('../../ServerComponents/helpers/typestate')
import Api = require('../../ServerComponents/api/ApiManager');
import Utils = require('../../ServerComponents/Helpers/Utils');
import SimSvc = require('../../SimulationService/api/SimServiceManager');
import Grid = require('../../ServerComponents/import/IsoLines');
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
    private powerLayer: Api.ILayer;
    private powerStations: Api.Feature[];

    constructor(namespace: string, name: string, public isClient = false, public options: Api.IApiManagerOptions = <Api.IApiManagerOptions>{}) {
        super(namespace, name, isClient, options);
    }

    start() {
        super.start();

        this.reset();
        this.initFSM();
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

        this.subscribeKey('sim.PowerStationCmd', <Api.ApiMeta>{}, (topic: string, message: string, params: Object) => {
            Winston.info(`Topic: ${topic}, Msg: ${JSON.stringify(message, null, 2)}, Params: ${params ? JSON.stringify(params, null, 2) : '-'}.`)
            if (message.hasOwnProperty('powerStation') && message.hasOwnProperty('state')) {
                var name = message['powerStation'];
                this.powerStations.some(ps => {
                    if (ps.properties.hasOwnProperty('name') && ps.properties['name'] !== name) return false;
                    this.setFeatureState(ps, message['state'], SimSvc.FailureMode.Unknown, true);
                    return true;
                });
            }
        });

        this.on(Api.Event[Api.Event.LayerChanged], (changed: Api.IChangeEvent) => {
            if (changed.id !== 'floodsim') return;
            var layer = <Api.ILayer> changed.value;
            if (!layer.data) return;
            Winston.info('Floodsim layer received');
            Winston.info(`ID  : ${changed.id}`);
            Winston.info(`Type: ${changed.type}`);
            this.flooding(layer);
        });
    }

    private flooding(layer: Api.ILayer) {
        var getWaterLevel = this.convertLayerToGrid(layer);
        var failedPowerStations: Api.Feature[] = [];

        // Check is Powerstation is flooded
        this.powerStations.forEach(ps => {
            var state = this.getFeatureState(ps);
            if (state === SimSvc.InfrastructureState.Failed) failedPowerStations.push(ps);
            // if (state !== SimSvc.InfrastructureState.Ok) return;
            var waterLevel = getWaterLevel(ps.geometry.coordinates);
            if (waterLevel > 0) {
                this.setFeatureState(ps, SimSvc.InfrastructureState.Failed, SimSvc.FailureMode.Flooded, true);
                failedPowerStations.push(ps);
            }
        });

        // Check if Powerstation's dependencies have failed
        this.powerStations.forEach(ps => {
            if (!ps.properties.hasOwnProperty('dependencies')) return;
            var state = this.getFeatureState(ps);
            if (state === SimSvc.InfrastructureState.Failed) return;
            var dependencies = ps.properties['dependencies'];

        });
    }

    private convertLayerToGrid(layer: Api.ILayer) {
        var gridParams = <Grid.IGridDataSourceParameters>{};
        Grid.IsoLines.convertEsriHeaderToGridParams(layer, gridParams);
        var gridData = Grid.IsoLines.convertDataToGrid(layer, gridParams);

        return function getWaterLevel(pt: number[]): number {
            var col = Math.floor((pt[0] - gridParams.startLon) / gridParams.deltaLon);
            if (col < 0 || col >= gridData[0].length) return -1;
            var row = Math.floor((pt[1] - gridParams.startLat) / gridParams.deltaLat);
            if (row < 0 || row >= gridData.length) return -1;
            var waterLevel = gridData[row][col];
            return waterLevel;
        }
    }

    /** Reset the state to the original state. */
    private reset() {
        this.powerStations = [];
        // Copy original GeoJSON layers to dynamic layers
        var sourceFolder = path.join(this.rootPath, this.relativeSourceFolder);

        var stationsFile = path.join(sourceFolder, 'power_stations.json');
        fs.readFile(stationsFile, (err, data) => {
            if (err) {
                Winston.error(`Error reading ${stationsFile}: ${err}`);
                return;
            }
            let ps = JSON.parse(data.toString());
            this.powerLayer = this.createNewLayer('powerstations', 'Stroomstations', ps.features, 'Elektrische stroomstations');
            this.powerLayer.features.forEach(f => {
                if (!f.id) f.id = Utils.newGuid();
                if (f.geometry.type !== 'Point') return;
                this.setFeatureState(f, SimSvc.InfrastructureState.Ok);
                this.powerStations.push(f);
            });

            this.publishLayer(this.powerLayer);
        });
    }

    /** Set the state and failure mode of a feature, optionally publishing it too. */
    private setFeatureState(feature: Api.Feature, state: SimSvc.InfrastructureState, failureMode: SimSvc.FailureMode = SimSvc.FailureMode.None, publish: boolean = false) {
        feature.properties['state'] = state;
        feature.properties['failureMode'] = failureMode;
        if (!publish) return;
        // Publish feature update
        this.updateFeature(this.powerLayer.id, feature, <Api.ApiMeta>{}, () => { });
        // Publish PowerSupplyArea layer
        if (state === SimSvc.InfrastructureState.Failed && feature.properties.hasOwnProperty('powerSupplyArea')) {
            var psa = new Api.Feature();
            psa.properties = {
                name: 'Blackout area',
                featureTypeId: 'AffectedArea'
            };
            psa.geometry = JSON.parse(feature.properties['powerSupplyArea']);
            this.addFeature(this.powerLayer.id, psa, <Api.ApiMeta>{}, () => { });
        }
    }

    private getFeatureState(feature: Api.Feature) {
        return <SimSvc.InfrastructureState>feature.properties['state'];
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
