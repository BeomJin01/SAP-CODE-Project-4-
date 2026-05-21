sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/core/routing/History"
], (Controller, History) => {
    "use strict";

    return Controller.extend("code.t4.ui5.mm04.controller.Detail", {

        onInit() {
            // 라우터에서 Detail 패턴 매칭 시 호출
            const oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("RouteDetail").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched(oEvent) {
            // URL에서 mpsRunId 파라미터 추출
            const sMpsRunId = oEvent.getParameter("arguments").mpsRunId;
            this._sMpsRunId = sMpsRunId;
        },

        onNavBack() {
            // 뒤로가기
            const oHistory = History.getInstance();
            const sPreviousHash = oHistory.getPreviousHash();

            if (sPreviousHash !== undefined) {
                window.history.go(-1);
            } else {
                const oRouter = this.getOwnerComponent().getRouter();
                oRouter.navTo("RouteMain", {}, true);
            }
        }
    });
});