var express = require('express');
var path = require('path');
var cc = require("./../ServerComponents/dynamic/ClientConnection");
var ProjectRepositoryService = require('./../ServerComponents/creator/ProjectRepositoryService');
var DataSource = require("./../ServerComponents/dynamic/DataSource");
var MessageBus = require('./../ServerComponents/bus/MessageBus');
var ConfigurationService = require('./../ServerComponents/configuration/ConfigurationService');
var LayerDirectory = require("./../ServerComponents/dynamic/LayerDirectory");
var store = require('./../ServerComponents/import/Store');
var ApiServiceManager = require('./../ServerComponents/api/ApiServiceManager');
var RestAPI = require('./../ServerComponents/api/RestAPI');
var MqttAPI = require('./../ServerComponents/api/MqttAPI');
var SocketIOAPI = require('./../ServerComponents/api/SocketIOAPI');
var Winston = require('winston');
var SimulationManager = require('./src/SimulationManager');
Winston.remove(Winston.transports.Console);
Winston.add(Winston.transports.Console, {
    colorize: true,
    prettyPrint: true
});
var favicon = require('serve-favicon');
var bodyParser = require('body-parser');
var server = express();
var httpServer = require('http').Server(server);
var cm = new cc.ConnectionManager(httpServer);
var messageBus = new MessageBus.MessageBusService();
var config = new ConfigurationService('./configuration.json');
var port = "3333";
server.set('port', port);
server.use(favicon(__dirname + '/public/favicon.ico'));
server.use(bodyParser.json({ limit: '25mb' }));
server.use(bodyParser.urlencoded({ limit: '25mb', extended: true }));
config.add("server", "http://localhost:" + port);
var ld = new LayerDirectory.LayerDirectory(server, cm);
ld.Start();
var ds = new DataSource.DataSourceService(cm, "DataSource");
ds.start();
server.get("/datasource", ds.getDataSource);
server.use(express.static(path.join(__dirname, 'swagger')));
var apiServiceMgr = new ApiServiceManager(server, config);
var resourceTypeStore = new ProjectRepositoryService(new store.FolderStore({ storageFolder: "public/data/resourceTypes" }));
apiServiceMgr.addService(resourceTypeStore);
server.use(express.static(path.join(__dirname, 'public')));
var api = new SimulationManager.SimulationManager('SimulationManager');
api.init(path.join(path.resolve(__dirname), "public/data"), function () {
    api.addConnector("rest", new RestAPI.RestAPI(server), {});
    api.addConnector("socketio", new SocketIOAPI.SocketIOAPI(cm), {});
    api.addConnector("mqtt", new MqttAPI.MqttAPI("localhost", 1883), {});
});
httpServer.listen(server.get('port'), function () {
    Winston.info('Express server listening on port ' + server.get('port'));
});
