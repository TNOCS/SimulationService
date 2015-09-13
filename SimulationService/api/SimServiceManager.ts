import Winston = require('winston');
import TypeState = require('../state/typestate');
import ApiManager = require('../../ServerComponents/api/ApiManager');
import Utils = require('../../ServerComponents/helpers/Utils');

export enum SimCommand {
    Start, Pause, Stop
}


/** Simulation state */
export enum SimulationState {
    Idle,
    Start,
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

    constructor(public isClient = false) {
        super(isClient);
        this.simTime = new Date();
    }

    init() {
        Winston.info(`sim: Init layer manager (isClient=${this.isClient})`);

        this.fsm = new TypeState.FiniteStateMachine<SimulationState>(SimulationState.Idle);
        // Define transitions
        this.fsm.from(SimulationState.Idle).to(SimulationState.Start);
        this.fsm.from(SimulationState.Start).to(SimulationState.Idle);
        this.fsm.from(SimulationState.Start).to(SimulationState.Busy);
        this.fsm.from(SimulationState.Start).to(SimulationState.Pause);
        this.fsm.from(SimulationState.Pause).to(SimulationState.Start);
        this.fsm.from(SimulationState.Pause).to(SimulationState.Idle);
        this.fsm.from(SimulationState.Busy).to(SimulationState.Start);

        // Listen to state changes
        this.fsm.onTransition = (fromState: SimulationState, toState: SimulationState) => {
            this.publishState(fromState, toState)
        }

        // this.fsm.on(SimulationState.Idle, (from: SimulationState) => {
        //     this.publishState();
        // });

        // this.keys['hello'] = {
        //     id: 'test',
        //     title: 'world',
        //     storage: 'file'
        // };
    }

    public publishState(fromState: SimulationState, toState: SimulationState) {
        Winston.info(`sim: transitioning from ${SimulationState[fromState]} to ${SimulationState[toState]}.`);
        var state = {
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
            Winston.info(`sim: new command ${SimCommand[this.simCmd]}`);
            switch (this.simCmd) {
                case SimCommand.Start:
                    if (this.fsm.canGo(SimulationState.Start)) this.fsm.go(SimulationState.Start);
                    break;
                case SimCommand.Pause:
                    if (this.fsm.canGo(SimulationState.Pause)) this.fsm.go(SimulationState.Pause);
                    break;
                case SimCommand.Stop:
                    if (this.fsm.canGo(SimulationState.Idle)) this.fsm.go(SimulationState.Idle);
                    break;
            }
        }
        this.emit('simTimeChanged', {
            time: this.simTime,
            speed: this.simSpeed,
            cmd: this.simCmd
        });
    }
}
