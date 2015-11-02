import express = require('express');
import http = require('http');
import path = require('path');
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
import MongoDB = require('./../ServerComponents/api/MongoDB');
import FileStorage = require('./../ServerComponents/api/FileStorage');
// import ImbAPI = require('./../ServerComponents/api/ImbAPI');
import Utils = require('./../ServerComponents/helpers/Utils');
import Winston = require('winston');

require('./../ServerComponents/helpers/DateUtils');

import HazardousObjectSim = require('./src/HazardousObjectSim');

Winston.remove(Winston.transports.Console);
Winston.add(Winston.transports.Console, <Winston.ConsoleTransportOptions>{
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
var port = 3339;
server.set('port', port);
server.use(favicon(__dirname + '/public/favicon.ico'));
//increased limit size, see: http://stackoverflow.com/questions/19917401/node-js-express-request-entity-too-large
server.use(bodyParser.json({ limit: '25mb' })); // support json encoded bodies
server.use(bodyParser.urlencoded({ limit: '25mb', extended: true })); // support encoded bodies

// CORRS: see http://stackoverflow.com/a/25148861/319711
server.use(function (req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header('Access-Control-Allow-Methods', 'GET');
  res.header("Access-Control-Allow-Headers", "X-Requested-With, Content-Type");
  next();
});
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

var api = new HazardousObjectSim.HazardousObjectSim('cs', 'HazardousObjectSim', false, <Api.IApiManagerOptions>{
    server: `${Utils.getIPAddress()}:${port}`,
    mqttSubscriptions: ['cs/keys/Sim/SimTime', 'cs/layers/floodsim', 'cs/layers/powerstations/feature/#']
});
api.init(path.join(path.resolve(__dirname), "public/data"), () => {
    api.addConnector("rest", new RestAPI.RestAPI(server), {});
    // api.addConnector("socketio", new SocketIOAPI.SocketIOAPI(cm), {});
    api.addConnector("mqtt", new MqttAPI.MqttAPI("localhost", 1883), {});
    api.addConnector("file", new FileStorage.FileStorage(path.join(path.resolve(__dirname), "public/data/"), true), {});
    api.start();
});

httpServer.listen(server.get('port'), () => {
    Winston.info('Express server listening on port ' + server.get('port'));
});
