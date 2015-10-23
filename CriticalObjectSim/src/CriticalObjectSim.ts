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
export class CriticalObjectSim extends SimSvc.SimServiceManager {
    /** Relative folder for the original source files */
    private relativeSourceFolder = 'source';
    /** Simulation start time */
    private simStartTime: Date;
    private criticalObjectsLayer: Api.ILayer;
    private criticalObjects: Api.Feature[];

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
            this.message = 'Critical objects have been reset.'
            return true;
        });

        this.on(Api.Event[Api.Event.LayerChanged], (changed: Api.IChangeEvent) => {
            if (changed.id !== 'floodsim' || !changed.value) return;
            var layer = <Api.ILayer> changed.value;
            if (!layer.data) return;
            Winston.info('Floodsim layer received');
            Winston.info(`ID  : ${changed.id}`);
            Winston.info(`Type: ${changed.type}`);
            this.flooding(layer);
        });

        this.on(Api.Event[Api.Event.LayerChanged], (changed: Api.IChangeEvent) => {
            if (changed.id !== 'powerstations' || !changed.value) return;
            var layer = <Api.ILayer> changed.value;
            if (!layer.features) return;
            Winston.info('Powerstations layer received');
            Winston.info(`ID  : ${changed.id}`);
            Winston.info(`Type: ${changed.type}`);
            this.blackout(layer);
        });
    }

    private blackout(layer: Api.ILayer) {
        var failedObjects = this.checkBlackoutAreas(layer);
        this.checkDependencies(failedObjects);
    }

    private checkBlackoutAreas(layer: Api.ILayer) {
        var totalBlackoutArea = this.concatenateBlackoutAreas(layer);
        var failedObjects: string[] = [];

        // Check if CO is in blackout area
        for (let i = 0; i < this.criticalObjects.length; i++) {
            var co = this.criticalObjects[i];
            var state = this.getFeatureState(co);
            if (state === SimSvc.InfrastructureState.Failed) {
                failedObjects.push(co.properties['name']);
                continue;
            }
            var inBlackout = this.pointInsideMultiPolygon(co.geometry.coordinates, totalBlackoutArea.coordinates);
            if (inBlackout) {
                //TODO: Check if Auxilary Power Supply is available
                this.setFeatureState(co, SimSvc.InfrastructureState.Stressed, SimSvc.FailureMode.LimitedPower, true);
                failedObjects.push(co.properties['name']);
            }
        }
        return failedObjects;
    }

    private concatenateBlackoutAreas(layer: Api.ILayer): Api.Geometry {
        var totalArea: Api.Geometry = {type: "MultiPolygon", coordinates: [] };
        var count = 0;
        layer.features.forEach((f) => {
            if (f.properties && f.properties.hasOwnProperty('featureTypeId') && f.properties['featureTypeId'] === 'AffectedArea') {
                if (f.geometry.type === "Polygon") {
                    totalArea.coordinates.push(f.geometry.coordinates);
                    count += 1;
                }
            }
        });
        Winston.info('Concatenated ' + count + ' blackout areas');
        return totalArea;
    }

    private flooding(layer: Api.ILayer) {
        var failedObjects = this.checkWaterLevel(layer);
        this.checkDependencies(failedObjects);
    }

    private checkWaterLevel(layer: Api.ILayer) {
        var getWaterLevel = this.convertLayerToGrid(layer);
        var failedObjects: string[] = [];

        // Check is CO is flooded
        for (let i = 0; i < this.criticalObjects.length; i++) {
            var co = this.criticalObjects[i];
            var state = this.getFeatureState(co);
            if (state === SimSvc.InfrastructureState.Failed) {
                failedObjects.push(co.properties['name']);
                continue;
            }
            var waterLevel = getWaterLevel(co.geometry.coordinates);
            if (waterLevel > 0) {
                this.setFeatureState(co, SimSvc.InfrastructureState.Failed, SimSvc.FailureMode.Flooded, true);
                failedObjects.push(co.properties['name']);
            }
        }
        return failedObjects;
    }

    private checkDependencies(failedObjects: string[]) {
        if (failedObjects.length === 0) return;
        var additionalFailures = false;
        for (let i = 0; i < this.criticalObjects.length; i++) {
            var co = this.criticalObjects[i];
            if (!co.properties.hasOwnProperty('dependencies')) continue;
            var state = this.getFeatureState(co);
            if (state === SimSvc.InfrastructureState.Failed) continue;
            var dependencies: string[] = co.properties['dependencies'];
            var failedDependencies = 0;
            dependencies.forEach(dp => {
                if (failedObjects.indexOf(dp) >= 0) failedDependencies++;
            });
            if (failedDependencies === 0) continue;
            if (failedDependencies < dependencies.length) {
                this.setFeatureState(co, SimSvc.InfrastructureState.Stressed, SimSvc.FailureMode.LimitedPower, true);
            } else {
                this.setFeatureState(co, SimSvc.InfrastructureState.Failed, SimSvc.FailureMode.NoMainPower, true);
                failedObjects.push(co.properties["name"]);
                additionalFailures = true;
            }
        }
        if (additionalFailures) this.checkDependencies(failedObjects);
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
        this.deleteFilesInFolder(path.join(__dirname, '../public/data/layers'));
        this.deleteFilesInFolder(path.join(__dirname, '../public/data/keys'));

        this.criticalObjects = [];
        // Copy original GeoJSON layers to dynamic layers
        var sourceFolder = path.join(this.rootPath, this.relativeSourceFolder);

        var objectsFile = path.join(sourceFolder, 'critical_objects.json');
        fs.readFile(objectsFile, (err, data) => {
            if (err) {
                Winston.error(`Error reading ${objectsFile}: ${err}`);
                return;
            }
            let co = JSON.parse(data.toString());
            this.criticalObjectsLayer = this.createNewLayer('criticalobjects', 'Kwetsbare objecten', co.features);
            this.criticalObjectsLayer.features.forEach(f => {
                if (!f.id) f.id = Utils.newGuid();
                if (f.geometry.type !== 'Point') return;
                this.setFeatureState(f, SimSvc.InfrastructureState.Ok);
                this.criticalObjects.push(f);
            });

            this.publishLayer(this.criticalObjectsLayer);
        });
        this.fsm.currentState = SimSvc.SimState.Ready;
        this.sendAck(this.fsm.currentState);
    }

    /** Set the state and failure mode of a feature, optionally publishing it too. */
    private setFeatureState(feature: Api.Feature, state: SimSvc.InfrastructureState, failureMode: SimSvc.FailureMode = SimSvc.FailureMode.None, publish: boolean = false) {
        feature.properties['state'] = state;
        feature.properties['failureMode'] = failureMode;
        if (!publish) return;
        // Publish feature update
        this.updateFeature(this.criticalObjectsLayer.id, feature, <Api.ApiMeta>{}, () => { });
        // Publish PowerSupplyArea layer
        if (state === SimSvc.InfrastructureState.Failed && feature.properties.hasOwnProperty('contour')) {
            var contour = new Api.Feature();
            contour.id = Utils.newGuid();
            contour.properties = {
                name: 'Contour area',
                featureTypeId: 'AffectedArea'
            };
            contour.geometry = JSON.parse(feature.properties['contour']);
            this.addFeature(this.criticalObjectsLayer.id, contour, <Api.ApiMeta>{}, () => { });
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
            typeUrl: `${this.options.server}/api/resources/critical_objects`,
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

    /**
     * pointInsidePolygon returns true if a 2D point lies within a polygon of 2D points
     * @param  {number[]}   point   [lat, lng]
     * @param  {number[][]} polygon [[lat, lng], [lat,lng],...]
     * @return {boolean}            Inside == true
     */
    private pointInsidePolygon(point: number[], polygon: number[][][]): boolean {
        // https://github.com/substack/point-in-polygon
        // ray-casting algorithm based on
        // http://www.ecse.rpi.edu/Homepages/wrf/Research/Short_Notes/pnpoly.html
        var x = point[0];
        var y = point[1];
        var p = polygon[0];

        var inside = false;
        for (var i = 0, j = p.length - 1; i < p.length; j = i++) {
            var xi = p[i][0], yi = p[i][1];
            var xj = p[j][0], yj = p[j][1];

            var intersect = ((yi > y) != (yj > y))
                && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }

        return inside;
    }

    /**
     * pointInsideMultiPolygon returns true if a 2D point lies within a multipolygon
     * @param  {number[]}   point   [lat, lng]
     * @param  {number[][][]} polygon [[[lat, lng], [lat,lng]],...]]
     * @return {boolean}            Inside == true
     */
    private pointInsideMultiPolygon(point: number[], multipoly: number[][][][]): boolean {
        // https://github.com/substack/point-in-polygon
        // ray-casting algorithm based on
        // http://www.ecse.rpi.edu/Homepages/wrf/Research/Short_Notes/pnpoly.html
        var inside = false;
        for (var i = 0; i < multipoly.length; i++) {
            var polygon = multipoly[i];
            if (this.pointInsidePolygon(point, polygon)) inside = !inside;
        }
        return inside;
    }

}
