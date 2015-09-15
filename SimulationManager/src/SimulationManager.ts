import Winston = require('winston');
import TypeState = require('../../SimulationService/state/typestate');
import ApiManager = require('../../ServerComponents/api/ApiManager');
import SimulationService = require('../../SimulationService/api/SimServiceManager');
import HyperTimer = require('hypertimer');

export class SimulationManager extends SimulationService.SimServiceManager {
    private timer: HyperTimer;

    constructor(name: string, public isClient = false) {
        super(name, isClient);

        this.fsm.onEnter(SimulationService.SimulationState.Ready, () => {
            this.timer = new HyperTimer( {
                time: this.simTime,
                rate: this.simSpeed,
            });
            this.timer.setInterval(() => {
                this.simTime = this.timer.getTime();
                this.publishTime();
            }, 5000); // 5s
            return true;
        });

        this.fsm.onExit(SimulationService.SimulationState.Ready, () => {
            this.timer.pause();
            return true;
        });
    }

    private publishTime() {
        this.updateKey('SimTime', this.timer.getTime(), <ApiManager.ApiMeta>{}, () => { });
    }
}
