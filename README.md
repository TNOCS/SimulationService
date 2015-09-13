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
