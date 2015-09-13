import Winston = require('winston');
import ApiManager = require('../../ServerComponents/api/ApiManager');


export class SimServiceManager extends ApiManager.ApiManager {
    public simTime: Date;
    public simSpeed: number;

    constructor(public isClient = false) {
        super(isClient);
        this.simTime = new Date();
    }

    init() {
        Winston.info(`sim: Init layer manager (isClient=${this.isClient})`);
        this.keys['hello'] = {
            id: 'test',
            title: 'world',
            storage: 'file'
        };
    }

    public updateKey(keyId: string, value: Object, meta: ApiManager.ApiMeta, callback: Function) {
        switch (keyId) {
            case 'simTime':
                this.updateSimulationState(value);
                break;
            case 'job':
                break;
        }
        super.updateKey(keyId, value, meta, callback);
    }

    /**
     * Set the simulation speed and time.
     */
    private updateSimulationState(simState: Object) {
        Winston.info(`sim: simulation time updated ${JSON.stringify(simState, null, 2) }`);
        if (simState.hasOwnProperty('simTime')) {
            this.simTime = new Date(+simState['simTime']);
            Winston.info(`sim: new time ${this.simTime}`);
        }
        if (simState.hasOwnProperty('simSpeed')) {
            this.simSpeed = +simState['simSpeed'];
            Winston.info(`sim: new speed ${this.simSpeed}`);
        }
    }
}
