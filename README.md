# SimulationService

Based on the csWeb server, this is a dedicated simulation service, intended to run and return simulation results over REST, MQTT and other protocols.

## How to use

As this service uses the csWeb server for most of its functionality, you need to run the gulp (default) task to copy the required code from the csWeb repo to here.

The expect folder layout for the gulp task to work, therefore, is as follows:

```javascript
cs\
cs\apps
cs\apps\THIS_REPO
cs\csWeb
```

Alternatively, you can edit the ```path2csWeb``` variable in gulpfile.js.

## Running a simulation service

This project defines several simulation services. In principle, as each of them is standalone, each folder would require its own node_modules folder as well. As this is impractical, I've chosen a slightly different approach. By starting each service from the root folder, you only need to define node_modules at the top level. So you need to run:
```
ROOTPATH $ node SIMULATION_SERVICE_FOLDER/server.js
```
Clearly, in case your simulation requires many specific node_modules, you may reconsider this approach and use the node_modules locally again.

Furthermore, I've moved the main tsconfig.json to each and every SIMULATION_SERVICE_FOLDER.
