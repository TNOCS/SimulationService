import TypeState = require('../state/typestate');
import Api = require('../../ServerComponents/api/ApiManager');
export declare enum SimCommand {
    Start = 0,
    Pause = 1,
    Stop = 2,
    Run = 3,
    Finish = 4,
    Exit = 5,
}
export declare enum SimState {
    Idle = 0,
    Pause = 1,
    Ready = 2,
    Busy = 3,
    Exit = 4,
}
export interface ISimTimeState {
    simTime?: string;
    simSpeed?: string;
    simTimeStep?: string;
    simCmd?: string;
}
export declare enum Event {
    TimeChanged = 0,
}
export declare enum Keys {
    SimState = 0,
    SimTime = 1,
}
export interface ISimState {
    id: string;
    name: string;
    state: string;
    time: Date;
    msg?: string;
}
export declare class SimServiceManager extends Api.ApiManager {
    isClient: boolean;
    options: Api.IApiManagerOptions;
    static namespace: string;
    id: string;
    message: string;
    fsm: TypeState.FiniteStateMachine<SimState>;
    simTime: Date;
    simSpeed: number;
    simTimeStep: number;
    simCmd: SimCommand;
    constructor(namespace: string, name: string, isClient?: boolean, options?: Api.IApiManagerOptions);
    private terminateProcess();
    start(options?: Object): void;
    private sendAck();
    private publishStateChanged(fromState, toState);
    private updateSimulationState(simState);
}
