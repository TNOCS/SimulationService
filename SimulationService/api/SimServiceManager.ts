import Winston = require('winston');
import TypeState = require('../state/typestate');
import Api = require('../../ServerComponents/api/ApiManager');
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
    Pause,
    Ready,
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

export enum Event {
    TimeChanged
}

export class SimServiceManager extends Api.ApiManager {
    private id: string = Utils.newGuid();
    /** Name of the simulation service. */
    public name: string;
    /** Optional message to transmit with the state object */
    public message: string;
    public fsm: TypeState.FiniteStateMachine<SimulationState>;
    public simTime: Date;
    public simSpeed: number;
    public simCmd: SimCommand;

    constructor(name: string, public isClient = false) {
        super(isClient);
        this.name = name;
        this.simTime = new Date();

        Winston.info(`sim: Init layer manager (isClient=${this.isClient})`);

        this.fsm = new TypeState.FiniteStateMachine<SimulationState>(SimulationState.Idle);
        // Define transitions
        this.fsm.from(SimulationState.Idle).to(SimulationState.Ready).on(SimCommand.Start);
        this.fsm.from(SimulationState.Idle).to(SimulationState.Busy).on(SimCommand.Run);
        this.fsm.from(SimulationState.Ready).to(SimulationState.Idle).on(SimCommand.Stop);
        this.fsm.from(SimulationState.Ready).to(SimulationState.Busy).on(SimCommand.Run);
        this.fsm.from(SimulationState.Ready).to(SimulationState.Pause).on(SimCommand.Pause);
        this.fsm.from(SimulationState.Pause).to(SimulationState.Ready).on(SimCommand.Start);
        this.fsm.from(SimulationState.Pause).to(SimulationState.Idle).on(SimCommand.Stop);
        this.fsm.from(SimulationState.Busy).to(SimulationState.Ready).on(SimCommand.Finish);

        // Listen to state changes
        this.fsm.onTransition = (fromState: SimulationState, toState: SimulationState) => {
            this.publishStateChanged(fromState, toState)
        }

        // Listen to relevant KeyEvents (simTime, jobs)
        this.on(Api.Event[Api.Event.KeyChanged], (key: Api.IChangeEvent) => {
            if (!key.value.hasOwnProperty('type')) return;
            switch (key.value['type']) {
                case 'simTime':
                    this.updateSimulationState(key.value);
                    break;
                case 'job':
                    break;
            }
        });
    }

    /**
     * Override the start method to specify your own startup behaviour.
     * Although you could use the init method, at that time the connectors haven't been configured yet.
     */
    public start(options?: Object) { }

    /**
     * Send a message, acknowledging the fact that we have received a time step and are, depending on the state,
     * ready to move on.
     */
    private sendAck() {
        var state = {
            name: this.name,
            time: this.simTime,
            state: SimulationState[this.fsm.currentState]
        };
        if (this.message) state['msg'] = this.message;
        this.updateKey(`simState/${this.name}.${this.id}`, state, <Api.ApiMeta>{}, () => { });
    }

    /**
     * Publish a message when the state has changed, so when the sim was busy (and the simulation stopped) and moves
     * to the Ready state, we can continue running the simulation.
     */
    private publishStateChanged(fromState: SimulationState, toState: SimulationState) {
        Winston.info(`sim: transitioning from ${SimulationState[fromState]} to ${SimulationState[toState]}.`);
        this.sendAck();
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
        }

        this.emit(Event[Event.TimeChanged], {
            time: this.simTime,
            speed: this.simSpeed,
            cmd: this.simCmd
        });
        this.sendAck();
    }
}
