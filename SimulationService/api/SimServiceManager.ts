import Winston = require('winston');
import TypeState = require('../state/typestate');
import ApiManager = require('../../ServerComponents/api/ApiManager');
import Utils = require('../../ServerComponents/helpers/Utils');

export enum SimCommand {
    Start,
    Pause,
    Stop,
    Run,
    Finish
}


/** Simulation state */
export enum SimulationState {
    Idle,
    Ready,
    Pause,
    Busy
}

/** Simulation time state */
export interface ISimTimeState {
    /** Simulation time */
    simTime?: string;
    /** Simulation speed */
    simSpeed?: string;
    /** Simulation action command, e.g. start, stop, pause, reset */
    simCmd?: string;
}

export class SimServiceManager extends ApiManager.ApiManager {
    private id: string = Utils.newGuid();
    public fsm: TypeState.FiniteStateMachine<SimulationState>;
    public simTime: Date;
    public simSpeed: number;
    public simCmd: SimCommand;
    public name: string;

    constructor(name: string, public isClient = false) {
        super(isClient);
        this.name = name;
        this.simTime = new Date();

        Winston.info(`sim: Init layer manager (isClient=${this.isClient})`);

        this.fsm = new TypeState.FiniteStateMachine<SimulationState>(SimulationState.Idle);
        // Define transitions
        this.fsm.from(SimulationState.Idle).to(SimulationState.Ready).on(SimCommand.Start);
        this.fsm.from(SimulationState.Ready).to(SimulationState.Idle).on(SimCommand.Stop);
        this.fsm.from(SimulationState.Ready).to(SimulationState.Busy).on(SimCommand.Run);
        this.fsm.from(SimulationState.Ready).to(SimulationState.Pause).on(SimCommand.Pause);
        this.fsm.from(SimulationState.Pause).to(SimulationState.Ready).on(SimCommand.Start);
        this.fsm.from(SimulationState.Pause).to(SimulationState.Idle).on(SimCommand.Stop);
        this.fsm.from(SimulationState.Busy).to(SimulationState.Ready).on(SimCommand.Finish);

        // Listen to state changes
        this.fsm.onTransition = (fromState: SimulationState, toState: SimulationState) => {
            this.publishState(fromState, toState)
        }

    }

    public publishState(fromState: SimulationState, toState: SimulationState) {
        Winston.info(`sim: transitioning from ${SimulationState[fromState]} to ${SimulationState[toState]}.`);
        var state = {
            name: this.name,
            time: this.simTime,
            fromState: SimulationState[fromState],
            toState: SimulationState[toState]
        }
        this.updateKey(this.id, state, <ApiManager.ApiMeta>{}, () => { });
    }

    public updateKey(keyId: string, value: Object, meta: ApiManager.ApiMeta, callback: Function) {
        if (value.hasOwnProperty('type')) {
            switch (value['type']) {
                case 'simTime':
                    this.updateSimulationState(value);
                    break;
                case 'job':
                    break;
            }
        }
        super.updateKey(keyId, value, meta, callback);
    }

    /**
     * Set the simulation speed and time.
     */
    private updateSimulationState(simState: ISimTimeState) {
        Winston.info(`sim: simulation time updated ${JSON.stringify(simState, null, 2) }`);
        if (simState.hasOwnProperty('simTime')) {
            this.simTime = new Date(+simState.simTime);
            Winston.info(`sim: new time ${this.simTime}`);
        }
        if (simState.hasOwnProperty('simSpeed')) {
            this.simSpeed = +simState.simSpeed;
            Winston.info(`sim: new speed ${this.simSpeed}`);
        }
        if (simState.hasOwnProperty('simCmd')) {
            this.simCmd = SimCommand[simState.simCmd];
            if (typeof this.simCmd === 'undefined') {
                Winston.warn('Received unknown sim command ' + simState.simCmd);
                return;
            }
            Winston.info(`sim: new command ${SimCommand[this.simCmd]}`);
            this.fsm.trigger(this.simCmd);

            // switch (this.simCmd) {
            //     case SimCommand.Start:
            //         if (this.fsm.canGo(SimulationState.Ready)) this.fsm.go(SimulationState.Ready);
            //         break;
            //     case SimCommand.Pause:
            //         if (this.fsm.canGo(SimulationState.Pause)) this.fsm.go(SimulationState.Pause);
            //         break;
            //     case SimCommand.Stop:
            //         if (this.fsm.canGo(SimulationState.Idle)) this.fsm.go(SimulationState.Idle);
            //         break;
            // }
        }
        this.emit('simTimeChanged', {
            time: this.simTime,
            speed: this.simSpeed,
            cmd: this.simCmd
        });
    }
}
