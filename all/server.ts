require('./../ServerComponents/helpers/DateUtils');

import express = require('express');
import http = require('http');
import path = require('path');
import Winston = require('winston');

import cc = require("./../ServerComponents/dynamic/ClientConnection");
import creator = require('./../ServerComponents/creator/MapLayerFactory');
import ProjectRepositoryService = require('./../ServerComponents/creator/ProjectRepositoryService');
import DataSource = require("./../ServerComponents/dynamic/DataSource");
import MessageBus = require('./../ServerComponents/bus/MessageBus');
import BagDatabase = require('./../ServerComponents/database/BagDatabase');
import ConfigurationService = require('./../ServerComponents/configuration/ConfigurationService');
import DynamicProject = require("./../ServerComponents/dynamic/DynamicProject");
import LayerDirectory = require("./../ServerComponents/dynamic/LayerDirectory");
import store = require('./../ServerComponents/import/Store');
import ApiServiceManager = require('./../ServerComponents/api/ApiServiceManager');
import Api = require('./../ServerComponents/api/ApiManager');
import RestAPI = require('./../ServerComponents/api/RestAPI');
import MqttAPI = require('./../ServerComponents/api/MqttAPI');
import SocketIOAPI = require('./../ServerComponents/api/SocketIOAPI');
import FileStorage = require('./../ServerComponents/api/FileStorage');
import Utils = require('./../ServerComponents/helpers/Utils');

import FloodSim = require('../FLoodSim/src/FloodSim');
import SimSvc = require('../SimulationService/api/SimServiceManager');
import SimMngr = require('./../SimulationManager/src/SimulationManager');


Winston.remove(Winston.transports.Console);
Winston.add(Winston.transports.Console, <Winston.ConsoleTransportOptions>{
    label: 'all',
    colorize: true,
    prettyPrint: true
});

var favicon = require('serve-favicon');
var bodyParser = require('body-parser')
var server = express();

var httpServer = require('http').Server(server);
var cm = new cc.ConnectionManager(httpServer);
var messageBus = new MessageBus.MessageBusService();
var config = new ConfigurationService('./configuration.json');

//This line is required when using JX to run the server, or else the input-messages coming from the Excel file will cause an error: https://github.com/jxcore/jxcore/issues/119
//require('http').setMaxHeaderLength(26214400);

// all environments
var port = "2015";
server.set('port', port);
server.use(favicon(__dirname + '/public/favicon.ico'));
//increased limit size, see: http://stackoverflow.com/questions/19917401/node-js-express-request-entity-too-large
server.use(bodyParser.json({ limit: '25mb' })); // support json encoded bodies
server.use(bodyParser.urlencoded({ limit: '25mb', extended: true })); // support encoded bodies

config.add("server", "http://localhost:" + port);

var ld = new LayerDirectory.LayerDirectory(server, cm);
ld.Start();

//var pr = new DynamicProject.DynamicProjectService(server, cm, messageBus);
//pr.Start(server);

var ds = new DataSource.DataSourceService(cm, "DataSource");
ds.start();
server.get("/datasource", ds.getDataSource);

server.use(express.static(path.join(__dirname, 'swagger')));

// Create the API service manager and add the services that you need
var apiServiceMgr = new ApiServiceManager(server, config);
// Resource types
var resourceTypeStore = new ProjectRepositoryService(new store.FolderStore({ storageFolder: "public/data/resourceTypes" }))
apiServiceMgr.addService(resourceTypeStore);

server.use(express.static(path.join(__dirname, 'public')));

var prefix = SimSvc.SimServiceManager.namespace;

var api = new SimMngr.SimulationManager('cs', 'SimulationManager', false, {
    server: `${Utils.getIPAddress()}:${port}`,
    mqttSubscriptions: [ 'cs/layers/floodsim', 'cs/layers/roadobjects/feature/#', 'cs/layers/powerstations/feature/#', 'cs/layers/criticalobjects/feature/#', 'cs/layers/communicationobjects/feature/#', 'cs/keys/#' ]
});
api.init(path.join(path.resolve(__dirname), "public/data"), () => {
    api.addConnector("rest", new RestAPI.RestAPI(server), {});
    api.addConnector("socketio", new SocketIOAPI.SocketIOAPI(cm), {});
    api.addConnector("mqtt", new MqttAPI.MqttAPI("localhost", 1883), {});
    api.addConnector("file", new FileStorage.FileStorage(path.join(path.resolve(__dirname), "public/data/")), {});
    api.start();
});

/** Start FloodSim server */
var floodSim = new FloodSim.FloodSim('cs', 'FloodSim', false, <Api.IApiManagerOptions>{
    server: `${Utils.getIPAddress()}:${port}`,
    mqttSubscriptions: ['cs/keys/Sim/SimTime', 'cs/keys/sim/floodSimCmd']
});
floodSim.init(path.join(path.resolve(__dirname), "../FloodSim/public/data"), () => {
    floodSim.addConnector("rest", new RestAPI.RestAPI(server), {});
    floodSim.addConnector("mqtt", new MqttAPI.MqttAPI("localhost", 1883), {});
    floodSim.addConnector("file", new FileStorage.FileStorage(path.join(path.resolve(__dirname), "../FloodSim/public/data/")), {});
    floodSim.start();
});


httpServer.listen(server.get('port'), () => {
    Winston.info('Express server listening on port ' + server.get('port'));
});
