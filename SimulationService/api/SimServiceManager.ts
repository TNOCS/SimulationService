import Winston = require('winston');
import TypeState = require('../state/typestate');
import Api = require('../../ServerComponents/api/ApiManager');
import Utils = require('../../ServerComponents/helpers/Utils');

export enum SimCommand {
    Start,
    Pause,
    Stop,
    Run,
    Finish,
    Exit
}

/** Simulation state */
export enum SimState {
    Idle,
    Pause,
    Ready,
    Busy,
    Exit
}

/** In what state is the (critical) infrastructure */
export enum InfrastructureState {
    /** 100% functional */
    Ok,
    /** Still working, but partially failing */
    Stressed,
    /** Not working anymore */
    Failed
}

/** When the infrastructure is stressed or has failed, what was the cause of its failure. */
export enum FailureMode {
    None = 0,
    Unknown = 1,
    Flooded = 2,
    NoMainPower = 4,
    NoBackupPower = 8,
    NoComms = 16   
}

/** Incident that has happened */
export enum Incident {
    Flooding,
    Earthquake,
    Fire,
    Explosion,
    GasDispersion,
    TerroristAttack,
    PowerFailure,
    CommunicationFailure,
    TrafficAccident
}

/** For setting the simulation time */
export interface ISimTimeState {
    /** Simulation time */
    simTime?: string;
    /** Simulation speed/rate, a positive number indicating how fast the simulation is running vs real-time. */
    simSpeed?: string;
    /** Simulation time step in msec, i.e. the interval at which time messages are send */
    simTimeStep?: string;
    /** Simulation action command, e.g. start, stop, pause, reset */
    simCmd?: string;
}

// /** Additional events that are emitted, besides the Api.Event */
// export enum Event {
//     TimeChanged,
//     StateChanged
// }

/** Name of the emitted Keys */
export enum Keys {
    /** For transmitting the simulation state */
    SimState,
    /** For transmitting the simulation time */
    SimTime,
    Job
}

export interface ISimState {
    id: string;
    name: string;
    state: string,
    time: Date,
    msg?: string
}

/**
 * Base class for a simulation service. It is not intended to run directly, but only adds time management
 * functionality to the ApiManager.
 */
export class SimServiceManager extends Api.ApiManager {
    /** Namespace for the simulation keys, e.g. /Sim/KEYS */
    static namespace: string = 'Sim';
    id: string = Utils.newGuid();
    /** Optional message to transmit with the state object */
    public message: string;
    public fsm: TypeState.FiniteStateMachine<SimState>;
    public simTime: Date;
    public simSpeed: number = 1;
    public simTimeStep = 1000;
    public simCmd: SimCommand;

    constructor(namespace: string, name: string, public isClient = false, public options: Api.IApiManagerOptions = <Api.IApiManagerOptions>{}) {
        super(namespace, name, isClient, options);
        this.simTime = new Date();

        Winston.info(`${this.name}: Init layer manager (isClient=${this.isClient})`);

        this.fsm = new TypeState.FiniteStateMachine<SimState>(SimState.Idle);
        // Define transitions
        this.fsm.from(SimState.Idle, SimState.Pause).to(SimState.Ready).on(SimCommand.Start);
        this.fsm.from(SimState.Idle).to(SimState.Busy).on(SimCommand.Run);
        this.fsm.from(SimState.Ready).to(SimState.Busy).on(SimCommand.Run);
        this.fsm.from(SimState.Ready).to(SimState.Pause).on(SimCommand.Pause);
        this.fsm.from(SimState.Ready, SimState.Pause, SimState.Busy).to(SimState.Idle).on(SimCommand.Stop);
        this.fsm.from(SimState.Busy).to(SimState.Ready).on(SimCommand.Finish);
        this.fsm.from(SimState.Idle, SimState.Ready, SimState.Busy, SimState.Pause).to(SimState.Exit).on(SimCommand.Exit);

        // Listen to state changes
        this.fsm.onTransition = (fromState: SimState, toState: SimState) => {
            this.publishStateChanged(fromState, toState)
        }

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

        this.cleanup(() => this.terminateProcess());
    }

    /**
     * Terminate the process cleanly, and let the simulation manager know that you have quit.
     * @method terminateProcess
     * @return {[type]}         [description]
     */
    private terminateProcess() {
        Winston.info("${this.name}: Terminating process. Bye!")
        this.sendAck(SimState.Exit);
    }

    /**
     * Override the start method to specify your own startup behaviour.
     * Although you could use the init method, at that time the connectors haven't been configured yet.
     */
    public start(options?: Object) {
        // Listen to SimTime keys
        this.subscribeKey(`${SimServiceManager.namespace}.${Keys[Keys.SimTime]}`, <Api.ApiMeta>{}, (topic: string, message: any, meta?: Api.ApiMeta) => {
            this.updateSimulationState(message);

            // try {
            //     //this.simTime = message.simTime;
            //     //Winston.error("Received Sim.SimTime: ", message);
            // } catch (e) {}
        });
        // Listen to JOBS
        this.subscribeKey(`${SimServiceManager.namespace}.${Keys[Keys.Job]}`, <Api.ApiMeta>{}, (topic: string, message: any, meta?: Api.ApiMeta) => {
            Winston.info("Received job: ", message);
        });
    }

    /**
     * Send a message, acknowledging the fact that we have received a time step and are, depending on the state,
     * ready to move on.
     */
    sendAck(curState: SimState) {
        var state: ISimState = {
            id: this.id,
            name: this.name,
            time: this.simTime,
            state: SimState[curState]
        };
        if (this.message) state['msg'] = this.message;
        this.updateKey(`${SimServiceManager.namespace}.${Keys[Keys.SimState]}.${this.name}`, state, <Api.ApiMeta>{}, () => { });
    }

    /**
     * Publish a message when the state has changed, so when the sim was busy (and the simulation stopped) and moves
     * to the Ready state, we can continue running the simulation.
     */
    private publishStateChanged(fromState: SimState, toState: SimState) {
        Winston.info(`${this.name}: transitioning from ${SimState[fromState]} to ${SimState[toState]}.`);
        this.sendAck(toState);
    }

    /**
     * Set the simulation speed and time.
     */
    private updateSimulationState(simState: ISimTimeState | number) {
        if (typeof simState === 'number') {
            // Simple message, just containing the time.
            this.simTime = new Date(simState);
            this.emit('simTimeChanged');
        } else {
            //Winston.info(`${this.name}: simulation time updated ${JSON.stringify(simState, null, 2) }`);
            if (simState.hasOwnProperty('simTime')) {
                this.simTime = new Date(+simState.simTime);
                this.emit('simTimeChanged');
                Winston.info(`sim: new time is ${this.simTime}`);
            }
            if (simState.hasOwnProperty('simSpeed') && this.simSpeed !== +simState.simSpeed) {
                this.simSpeed = +simState.simSpeed;
                this.emit('simSpeedChanged');
                Winston.info(`sim: new speed is ${this.simSpeed}`);
            }
            // if (simState.hasOwnProperty('simTimeStep')) {
            //     this.simTimeStep = +simState.simTimeStep;
            //     this.emit('simTimeStepChanged');
            //     Winston.info(`sim: new time step is ${this.simTimeStep} msec`);
            // }
            if (simState.hasOwnProperty('simCmd')) {
                this.simCmd = SimCommand[simState.simCmd];
                if (typeof this.simCmd === 'undefined') {
                    Winston.warn('${this.name}: Received unknown sim command ' + simState.simCmd);
                    return;
                }
                Winston.info(`${this.name}: new command is ${SimCommand[this.simCmd]}`);
                this.fsm.trigger(this.simCmd);
            } else {
                this.sendAck(this.fsm.currentState);
            }
        }
    }
}
