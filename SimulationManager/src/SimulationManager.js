var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var SimulationService = require('../../SimulationService/api/SimServiceManager');
var HyperTimer = require('hypertimer');
var SimulationManager = (function (_super) {
    __extends(SimulationManager, _super);
    function SimulationManager(name, isClient) {
        var _this = this;
        if (isClient === void 0) { isClient = false; }
        _super.call(this, name, isClient);
        this.isClient = isClient;
        this.fsm.onEnter(SimulationService.SimulationState.Ready, function () {
            _this.timer = new HyperTimer({
                time: _this.simTime,
                rate: _this.simSpeed,
            });
            _this.timer.setInterval(function () {
                _this.simTime = _this.timer.getTime();
                _this.publishTime();
            }, 5000);
            return true;
        });
        this.fsm.onExit(SimulationService.SimulationState.Ready, function () {
            _this.timer.pause();
            return true;
        });
    }
    SimulationManager.prototype.publishTime = function () {
        this.updateKey('SimTime', this.timer.getTime(), {}, function () { });
    };
    return SimulationManager;
})(SimulationService.SimServiceManager);
exports.SimulationManager = SimulationManager;
