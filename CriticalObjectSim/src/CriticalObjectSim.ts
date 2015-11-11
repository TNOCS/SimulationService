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

export interface ChartData {
    name: string;
    values: { x: number, y: number }[];
}

/**
 * CriticalObjectSim
 *
 * It listens to floodings: when a flooding occurs, all critical objects are checked, and, if flooded,
 * fail to perform their function.
 * Also, in case they experience a blackout, they will fail too.
 */
export class CriticalObjectSim extends SimSvc.SimServiceManager {
    /** Relative folder for the original source files */
    private relativeSourceFolder = 'source';
    private criticalObjectsLayer: Api.ILayer;
    private criticalObjects: Api.Feature[];
    private bedsChartData: ChartData[];

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
            //Why is this never reached?
            if (from === SimSvc.SimState.Idle) {
                this.bedsChartData = [
                    {
                        name: "available",
                        values: []
                    }, {
                        name: "failed",
                        values: []
                    }, {
                        name: "stressed",
                        values: []
                    }];
                this.sendChartValues();
            }
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
            Winston.info('COSim: Floodsim layer received');
            Winston.info(`ID  : ${changed.id}`);
            Winston.info(`Type: ${changed.type}`);
            this.flooding(layer);
        });

        this.on(Api.Event[Api.Event.FeatureChanged], (changed: Api.IChangeEvent) => {
            if (changed.id !== 'powerstations' || !changed.value) return;
            var f = <Api.Feature> changed.value;
            Winston.info('COSim: Powerstations feature received');
            Winston.info(`ID  : ${changed.id}`);
            Winston.info(`Type: ${changed.type}`);
            this.blackout(f);
        });

        this.on('simTimeChanged', () => {
            if (!this.nextEvent || this.nextEvent > this.simTime.getTime()) return;
            this.checkUps(); // Check power supplies
        });
    }

    private checkUps() {
        var updateChart = false;
        var eventTimes = [];
        for (let i = 0; i < this.criticalObjects.length; i++) {
            var co = this.criticalObjects[i];
            if (!co.properties.hasOwnProperty('willFailAt')) continue;
            if (co.properties['willFailAt'] > this.simTime.getTime()) {
                eventTimes.push(co.properties['willFailAt']);
                continue;
            } else {
                delete co.properties['willFailAt'];
                this.setFeatureState(co, SimSvc.InfrastructureState.Failed, SimSvc.FailureMode.NoBackupPower, null, true);
                updateChart = true;
            }
        }
        if (eventTimes.length > 0) {
            this.nextEvent = _.min(eventTimes);
        } else {
            this.nextEvent = null;
        }
        if (updateChart) this.sendChartValues();
    }

    private blackout(f: Api.Feature) {
        var failedObjects = this.checkBlackoutAreas(f);
        this.checkDependencies(failedObjects);
        this.sendChartValues(); // e.g., nr. of evacuated hospital beds.
    }

    private sendChartValues() {
        var stressedBeds = 0;
        var failedBeds = 0;
        var availableBeds = 0;
        for (let i = 0; i < this.criticalObjects.length; i++) {
            var co = this.criticalObjects[i];
            if (!co.properties.hasOwnProperty('Aantal bedden')) continue;
            var beds = co.properties['Aantal bedden'];
            var state = this.getFeatureState(co);
            switch (state) {
                case SimSvc.InfrastructureState.Ok:
                    availableBeds += beds;
                    break;
                case SimSvc.InfrastructureState.Stressed:
                    stressedBeds += beds;
                    break;
                case SimSvc.InfrastructureState.Failed:
                    failedBeds += beds;
                    break;
            }
        }
        if (!this.simStartTime) {
            Winston.error('CriticalObjectsSim: SimStartTime not found!');
            this.simStartTime = new Date(this.simTime.getTime());
        }
        var hours = Math.round((this.simTime.getTime() - this.simStartTime.getTime()) / 3600000);
        this.bedsChartData.forEach((c) => {
            var last = c.values[c.values.length - 1];
            if (last && last.x === this.simTime.getTime()) {
                c.values.pop(); //Remove the last element if it has the simtime has not changed yet
            }
            if (c.name === 'failed') {
                c.values.push({ x: hours, y: failedBeds });
            } else if (c.name === 'stressed') {
                c.values.push({ x: hours, y: stressedBeds });
            } else if (c.name === 'available') {
                c.values.push({ x: hours, y: availableBeds });
                Winston.info(`Available beds: ${availableBeds}`);
            }
        })
        this.updateKey("chart", { values: this.bedsChartData}, <Api.ApiMeta>{}, () => { });
    }

    private checkBlackoutAreas(f: Api.Feature) {
        // var totalBlackoutArea = this.concatenateBlackoutAreas(f);
        var totalBlackoutArea = f.geometry;
        var failedObjects: string[] = [];

        // Check if CO is in blackout area
        for (let i = 0; i < this.criticalObjects.length; i++) {
            var co = this.criticalObjects[i];
            var state = this.getFeatureState(co);
            if (state === SimSvc.InfrastructureState.Failed) {
                failedObjects.push(co.properties['name']);
                continue;
            }
            // var inBlackout = this.pointInsideMultiPolygon(co.geometry.coordinates, totalBlackoutArea.coordinates);
            var inBlackout = this.pointInsidePolygon(co.geometry.coordinates, totalBlackoutArea.coordinates);
            if (!inBlackout) continue;
            // Check for UPS
            var upsFound = false;
            if (co.properties['state'] === SimSvc.InfrastructureState.Ok && co.properties.hasOwnProperty('dependencies')) {
                co.properties['dependencies'].forEach((dep) => {
                    var splittedDep = dep.split('#');
                    if (splittedDep.length === 2) {
                        if (splittedDep[0] === 'UPS') {
                            let minutes = +splittedDep[1];
                            let failTime = this.simTime.addMinutes(minutes);
                            upsFound = true;
                            this.setFeatureState(co, SimSvc.InfrastructureState.Stressed, SimSvc.FailureMode.NoMainPower, failTime, true);
                        }
                    }
                });
            }
            if (!upsFound && !co.properties.hasOwnProperty('willFailAt')) {
                this.setFeatureState(co, SimSvc.InfrastructureState.Failed, SimSvc.FailureMode.NoBackupPower, null, true);
                failedObjects.push(co.properties['name']);
            }
            if (upsFound) {
                this.checkUps();
            }
        }
        return failedObjects;
    }

    private concatenateBlackoutAreas(layer: Api.ILayer): Api.Geometry {
        var totalArea: Api.Geometry = { type: "MultiPolygon", coordinates: [] };
        if (!layer || !layer.features) return totalArea;
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
        this.sendChartValues(); // e.g., nr. of evacuated hospital beds.
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
            // Check the max water level the object is able to resist
            var waterResistanceLevel = 0;
            if (co.properties.hasOwnProperty('dependencies')) {
                co.properties['dependencies'].forEach((dep) => {
                    var splittedDep = dep.split('#');
                    if (splittedDep.length === 2) {
                        if (splittedDep[0] !== 'water') return;
                        waterResistanceLevel = +splittedDep[1];
                    }
                });
            }
            if (waterLevel > waterResistanceLevel) {
                this.setFeatureState(co, SimSvc.InfrastructureState.Failed, SimSvc.FailureMode.Flooded, null, true);
                failedObjects.push(co.properties['name']);
            } else if (waterLevel > 0) {
                this.setFeatureState(co, SimSvc.InfrastructureState.Stressed, SimSvc.FailureMode.Flooded, null, true);
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
                this.setFeatureState(co, SimSvc.InfrastructureState.Stressed, SimSvc.FailureMode.LimitedPower, null, true);
            } else {
                this.setFeatureState(co, SimSvc.InfrastructureState.Failed, SimSvc.FailureMode.NoMainPower, null, true);
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
        this.bedsChartData = [{ name: "available", values: [] }, { name: "failed", values: [] }, { name: "stressed", values: [] }];
        this.nextEvent = null;
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
            this.sendChartValues();
        });
        this.fsm.currentState = SimSvc.SimState.Ready;
        this.sendAck(this.fsm.currentState);
    }

    /** Set the state and failure mode of a feature, optionally publishing it too. */
    private setFeatureState(feature: Api.Feature, state: SimSvc.InfrastructureState, failureMode: SimSvc.FailureMode = SimSvc.FailureMode.None, failureTime: Date = null, publish: boolean = false) {
        feature.properties['state'] = state;
        feature.properties['failureMode'] = failureMode;
        if (failureTime) feature.properties['willFailAt'] = failureTime.getTime();
        if (!publish) return;
        // Publish feature update
        this.updateFeature(this.criticalObjectsLayer.id, feature, <Api.ApiMeta>{}, () => { });
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
