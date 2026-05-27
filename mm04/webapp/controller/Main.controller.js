sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "code/t4/ui5/mm04/model/formatter"
], (Controller, JSONModel, Filter, FilterOperator, MessageBox, MessageToast, formatter) => {
    "use strict";

    return Controller.extend("code.t4.ui5.mm04.controller.Main", {
        // formatter 참조 (View XML에서 .formatter.xxx 형태로 사용)
        formatter: formatter,

        onInit() {
            // 조회 조건 바인딩용 뷰 모델 초기화
            const oViewModel = new JSONModel({
                searchWerks: "1000",
                searchMatnr: "",
                searchMaktx: "",   // 자재 F4 선택 후 자재명 표시용
                searchRunIdFrom: "",
                searchRunIdTo: "",
                searchStatus: "",
                searchStatusDetail: ""
            });
            this.getView().setModel(oViewModel, "viewModel");

            // 결과 테이블 모델 초기화
            const oTableModel = new JSONModel({ items: [] });
            this.getView().setModel(oTableModel, "mainTableModel");
        },

        // 조회 버튼 클릭
        onSearch() {
            const oView = this.getView();
            const oViewModel = oView.getModel("viewModel");
            const oData = oViewModel.getData();

            // 조회 조건 값 추출
            const sWerks = oData.searchWerks.trim();
            const sMatnr = oData.searchMatnr.trim();
            const sRunIdFrom = oData.searchRunIdFrom.trim();
            const sRunIdTo = oData.searchRunIdTo.trim();
            const sStatus = oData.searchStatus;

            // DateRangeSelection 값 추출
            const oDrsStart = oView.byId("drsStartDate");
            const oDrsEnd = oView.byId("drsEndDate");
            const oStartFrom = oDrsStart.getDateValue();
            const oStartTo = oDrsStart.getSecondDateValue();
            const oEndFrom = oDrsEnd.getDateValue();
            const oEndTo = oDrsEnd.getSecondDateValue();

            // 유효성 검증 1: 최소 1개 조건 필수
            if (!sWerks && !sMatnr && !sRunIdFrom && !oStartFrom && !oEndFrom && !sStatus) {
                MessageBox.error(this._i18n("msgNoCondition"));
                return;
            }

            // 유효성 검증 2: MPS 실행 ID From > To 역전 체크
            if (sRunIdFrom && sRunIdTo && sRunIdFrom > sRunIdTo) {
                MessageBox.error(this._i18n("msgRunIdFromTo"));
                return;
            }

            // 유효성 검증 3: 계획 시작일 역전 체크
            if (oStartFrom && oStartTo && oStartFrom > oStartTo) {
                MessageBox.error(this._i18n("msgDateFromTo"));
                return;
            }

            // 유효성 검증 4: 계획 종료일 역전 체크
            if (oEndFrom && oEndTo && oEndFrom > oEndTo) {
                MessageBox.error(this._i18n("msgDateFromTo"));
                return;
            }

            // OData 필터 구성
            const aFilters = [];

            if (sWerks) {
                aFilters.push(new Filter("Werks", FilterOperator.EQ, sWerks));
            }
            if (sMatnr) {
                aFilters.push(new Filter("Matnr", FilterOperator.EQ, sMatnr));
            }
            // MPS 실행 ID: From만 있으면 GE, From~To 둘 다 있으면 BT
            if (sRunIdFrom && sRunIdTo) {
                aFilters.push(new Filter("MpsRunId", FilterOperator.BT, sRunIdFrom, sRunIdTo));
            } else if (sRunIdFrom) {
                aFilters.push(new Filter("MpsRunId", FilterOperator.GE, sRunIdFrom));
            }
            if (sStatus) {
                aFilters.push(new Filter("Status", FilterOperator.EQ, sStatus));
            }

            // 날짜 필터: OData DateTime은 UTC 기준으로 변환 필요
            if (oStartFrom) {
                aFilters.push(new Filter("PlanStartDate", FilterOperator.GE,
                    new Date(Date.UTC(oStartFrom.getFullYear(), oStartFrom.getMonth(), oStartFrom.getDate()))
                ));
            }
            if (oStartTo) {
                aFilters.push(new Filter("PlanStartDate", FilterOperator.LE,
                    new Date(Date.UTC(oStartTo.getFullYear(), oStartTo.getMonth(), oStartTo.getDate()))
                ));
            }
            if (oEndFrom) {
                aFilters.push(new Filter("PlanEndDate", FilterOperator.GE,
                    new Date(Date.UTC(oEndFrom.getFullYear(), oEndFrom.getMonth(), oEndFrom.getDate()))
                ));
            }
            if (oEndTo) {
                aFilters.push(new Filter("PlanEndDate", FilterOperator.LE,
                    new Date(Date.UTC(oEndTo.getFullYear(), oEndTo.getMonth(), oEndTo.getDate()))
                ));
            }

            this._loadMpsRunList(aFilters);
        },

        // OData MpsRunSet 조회
        _loadMpsRunList(aFilters) {
            const oModel = this.getOwnerComponent().getModel();
            const oTableModel = this.getView().getModel("mainTableModel");

            oModel.read("/MpsRunSet", {
                filters: aFilters,
                success: (oData) => {
                    let aItems = oData.results;

                    // 상태상세 클라이언트 필터링
                    // EC_ONLY: EarliestWaDate 없는 EC (확정포함)
                    // WA:      EarliestWaDate 있는 EC (승인대기)
                    // CN:      EF 또는 CN (계획취소)
                    const sStatusDetail = this.getView().getModel("viewModel")
                        .getProperty("/searchStatusDetail");

                    if (sStatusDetail === "EC_ONLY") {
                        // 확정포함: Status=EC + EarliestWaDate 없음
                        aItems = aItems.filter(item =>
                            item.Status === "EC" && !item.EarliestWaDate
                        );
                    } else if (sStatusDetail === "WA") {
                        // 승인대기: Status=EC + EarliestWaDate 있음
                        aItems = aItems.filter(item =>
                            item.Status === "EC" && !!item.EarliestWaDate
                        );
                    } else if (sStatusDetail === "CN") {
                        // 계획취소: Status=EF 또는 CN
                        aItems = aItems.filter(item =>
                            item.Status === "EF" || item.Status === "CN"
                        );
                    }
                    // sStatusDetail === "" → 전체 (필터 없음)

                    oTableModel.setProperty("/items", aItems);

                    this.getView().byId("txtResultCount")
                        .setText(`MPS 실행 목록: ${aItems.length}건`);

                    if (aItems.length === 0) {
                        MessageToast.show(this._i18n("msgNoData"));
                    }
                },
                error: (oError) => {
                    // Gateway 에러 메시지 파싱 후 MessageBox 표시
                    let sMessage = "조회 중 오류가 발생했습니다.";
                    try {
                        const oResponse = JSON.parse(oError.responseText);
                        sMessage = oResponse.error.message.value;
                    } catch (e) {
                        // 파싱 실패 시 기본 메시지 사용
                    }
                    MessageBox.error(sMessage);
                }
            });
        },

        // 초기화 버튼 클릭
        onReset() {
            // 조회 조건 초기화
            this.getView().getModel("viewModel").setData({
                searchWerks: "1000",
                searchMatnr: "",
                searchMaktx: "",
                searchRunIdFrom: "",
                searchRunIdTo: "",
                searchStatus: "",
                searchStatusDetail: ""
            });

            // DateRangeSelection 초기화
            this.getView().byId("drsStartDate").setValue("");
            this.getView().byId("drsEndDate").setValue("");

            // 테이블 및 건수 초기화
            this.getView().getModel("mainTableModel").setProperty("/items", []);
            this.getView().byId("txtResultCount").setText("MPS 실행 목록: 0건");

            // 초기화 완료 메시지
            MessageToast.show("초기화 되었습니다.");
        },

        // 테이블 행 클릭 → Detail 화면 이동
        onRowPress(oEvent) {
            // ColumnListItem 또는 Link 클릭 모두 처리
            const oSource = oEvent.getSource();
            let oContext = oSource.getBindingContext("mainTableModel");

            // Link 클릭 시 부모(ColumnListItem)의 context 사용
            if (!oContext) {
                oContext = oSource.getParent().getBindingContext("mainTableModel");
            }
            if (!oContext) return;

            const sMpsRunId = oContext.getProperty("MpsRunId");
            this.getOwnerComponent().getRouter().navTo("RouteDetail", {
                mpsRunId: encodeURIComponent(sMpsRunId)
            });
        },

        // 대시보드 이동
        onNavToDashboard() {
            this.getOwnerComponent().getRouter().navTo("RouteDashboard");
        },

        // 새로고침
        onRefresh() {
            this.onSearch();
            MessageToast.show("새로고침 되었습니다.");
        },

        // 플랜트 F4 서치헬프
        onPlantF4() {
            if (!this._oPlantDialog) {
                const oPlantModel = new JSONModel({ items: [] });

                this._oPlantDialog = new sap.m.Dialog({
                    title: "플랜트 검색",
                    contentWidth: "30rem",
                    afterClose: () => {
                        // 다이얼로그 닫힐 때 SearchField 초기화
                        const oSF = this._oPlantDialog.getContent()[0];
                        oSF.setValue("");
                    },
                    content: [
                        new sap.m.SearchField({
                            placeholder: "플랜트 코드 또는 플랜트명 검색...",
                            search: this._onPlantSearch.bind(this)
                        }),
                        new sap.m.Table({
                            columns: [
                                new sap.m.Column({ header: new sap.m.Text({ text: "플랜트 코드" }) }),
                                new sap.m.Column({ header: new sap.m.Text({ text: "플랜트명" }) })
                            ],
                            items: {
                                path: "plantModel>/items",
                                template: new sap.m.ColumnListItem({
                                    type: "Active",
                                    press: this._onPlantSelect.bind(this),
                                    cells: [
                                        new sap.m.Text({ text: "{plantModel>Werks}" }),
                                        new sap.m.Text({ text: "{plantModel>Name1}" })
                                    ]
                                })
                            }
                        })
                    ],
                    buttons: [
                        new sap.m.Button({
                            text: "취소",
                            press: () => this._oPlantDialog.close()
                        })
                    ]
                });

                // 모델 먼저 세팅 후 addDependent
                this._oPlantDialog.setModel(oPlantModel, "plantModel");
                this.getView().addDependent(this._oPlantDialog);
            }

            // 전체 목록 조회 및 다이얼로그 열기
            this._oPlantDialog.open();
            this._loadPlantList();
        },

        _loadPlantList(sKeyword) {
            const oModel = this.getOwnerComponent().getModel();

            oModel.read("/PlantSet", {
                groupId: "$direct",
                success: (oData) => {
                    let aItems = oData.results;

                    // 클라이언트 사이드 필터링
                    if (sKeyword) {
                        const sUpper = sKeyword.toUpperCase();
                        aItems = aItems.filter(item =>
                            item.Werks.toUpperCase().includes(sUpper) ||
                            item.Name1.toUpperCase().includes(sUpper)
                        );
                    }

                    this._oPlantDialog.getModel("plantModel")
                        .setProperty("/items", aItems);
                },
                error: (oError) => {
                    let sMessage = "플랜트 조회 중 오류가 발생했습니다.";
                    try { sMessage = JSON.parse(oError.responseText).error.message.value; } catch (e) { }
                    MessageBox.error(sMessage);
                }
            });
        },

        _onPlantSearch(oEvent) {
            // search 이벤트: query 파라미터 사용
            // 빈 문자열이면 전체 조회
            const sQuery = oEvent.getParameter("query") || "";
            this._loadPlantList(sQuery || undefined);
        },

        _onPlantSelect(oEvent) {
            const oItem = oEvent.getSource().getBindingContext("plantModel");
            this.getView().getModel("viewModel").setProperty("/searchWerks", oItem.getProperty("Werks"));
            this._oPlantDialog.close();
        },

        // 자재 F4 서치헬프
        onMaterialF4() {
            if (!this._oMaterialDialog) {
                const oMaterialModel = new JSONModel({ items: [] });

                this._oMaterialDialog = new sap.m.Dialog({
                    title: "자재코드 검색 (완제품)",
                    contentWidth: "50rem",
                    afterClose: () => {
                        // 다이얼로그 닫힐 때 SearchField + 목록 초기화
                        const oSF = this._oMaterialDialog.getContent()[0];
                        oSF.setValue("");
                        this._oMaterialDialog.getModel("materialModel")
                            .setProperty("/items", []);
                    },
                    content: [
                        new sap.m.SearchField({
                            placeholder: "자재코드 또는 자재명 검색...",
                            search: this._onMaterialSearch.bind(this)
                        }),
                        new sap.m.Table({
                            columns: [
                                new sap.m.Column({ header: new sap.m.Text({ text: "자재코드" }) }),
                                new sap.m.Column({ header: new sap.m.Text({ text: "자재명" }) }),
                                new sap.m.Column({ header: new sap.m.Text({ text: "자재유형" }) })
                            ],
                            items: {
                                path: "materialModel>/items",
                                template: new sap.m.ColumnListItem({
                                    type: "Active",
                                    press: this._onMaterialSelect.bind(this),
                                    cells: [
                                        new sap.m.Text({ text: "{materialModel>Matnr}" }),
                                        new sap.m.Text({ text: "{materialModel>Maktx}" }),
                                        new sap.m.Text({ text: "{materialModel>Mtart}" })
                                    ]
                                })
                            }
                        })
                    ],
                    buttons: [
                        new sap.m.Button({
                            text: "취소",
                            press: () => this._oMaterialDialog.close()
                        })
                    ]
                });

                this._oMaterialDialog.setModel(oMaterialModel, "materialModel");
                this.getView().addDependent(this._oMaterialDialog);
            }

            // 처음 열 때 전체 조회 안 함 → 검색어 입력 후 조회
            this._oMaterialDialog.open();
            this._loadMaterialList();
        },
        _loadMaterialList(sKeyword) {
            const oModel = this.getOwnerComponent().getModel();

            oModel.read("/MaterialSet", {
                groupId: "$direct",
                success: (oData) => {
                    let aItems = oData.results;

                    // 클라이언트 사이드 필터링
                    if (sKeyword) {
                        const sUpper = sKeyword.toUpperCase();
                        aItems = aItems.filter(item =>
                            item.Matnr.toUpperCase().includes(sUpper) ||
                            item.Maktx.toUpperCase().includes(sUpper)
                        );
                    }

                    this._oMaterialDialog.getModel("materialModel")
                        .setProperty("/items", aItems);
                },
                error: (oError) => {
                    let sMessage = "자재 조회 중 오류가 발생했습니다.";
                    try { sMessage = JSON.parse(oError.responseText).error.message.value; } catch (e) { }
                    MessageBox.error(sMessage);
                }
            });
        },

        _onMaterialSearch(oEvent) {
            const sQuery = oEvent.getParameter("query") || "";
            this._loadMaterialList(sQuery || undefined);
        },

        _onMaterialSelect(oEvent) {
            const oItem = oEvent.getSource().getBindingContext("materialModel");
            const oViewModel = this.getView().getModel("viewModel");
            oViewModel.setProperty("/searchMatnr", oItem.getProperty("Matnr"));
            oViewModel.setProperty("/searchMaktx", oItem.getProperty("Maktx"));
            this._oMaterialDialog.close();
        },
        // 동적 자재명 변경
        onMatnrLiveChange(oEvent) {
            const sMatnr = oEvent.getParameter("value").trim();
            const oViewModel = this.getView().getModel("viewModel");

            // 입력값 없으면 즉시 클리어
            if (!sMatnr) {
                oViewModel.setProperty("/searchMaktx", "");
                return;
            }

            // debounce: 300ms 이내 재입력 시 이전 요청 취소
            // 마지막 타이핑 후 300ms 뒤에만 실제 조회 실행
            if (this._oMatnrTimer) {
                clearTimeout(this._oMatnrTimer);
            }

            // 현재 요청 식별용 시퀀스 번호
            // 비동기 응답이 뒤바뀌어도 마지막 요청 결과만 반영
            this._iMatnrSeq = (this._iMatnrSeq || 0) + 1;
            const iCurrentSeq = this._iMatnrSeq;

            this._oMatnrTimer = setTimeout(() => {
                const oModel = this.getOwnerComponent().getModel();

                oModel.read("/MaterialSet", {
                    filters: [
                        new Filter("Matnr", FilterOperator.EQ, sMatnr)
                    ],
                    groupId: "$direct",
                    success: (oData) => {
                        if (iCurrentSeq !== this._iMatnrSeq) return;

                        // Gateway가 부분일치 결과를 줄 수 있으므로
                        // 클라이언트에서 완전일치(대소문자 무관) 한 번 더 검증
                        const oMatched = oData.results.find(
                            item => item.Matnr.toUpperCase() === sMatnr.toUpperCase()
                        );

                        if (oMatched) {
                            oViewModel.setProperty("/searchMaktx", oMatched.Maktx);
                        } else {
                            oViewModel.setProperty("/searchMaktx", "");
                        }
                    },
                });
            }, 300); // 300ms debounce
        },
        // MPS 실행 ID F4 서치헬프
        // MPS 실행 ID From F4
        onMpsRunIdFromF4() {
            this._sMpsRunIdTarget = "From";
            this._openMpsRunIdDialog();
        },

        // MPS 실행 ID To F4
        onMpsRunIdToF4() {
            this._sMpsRunIdTarget = "To";
            this._openMpsRunIdDialog();
        },

        _openMpsRunIdDialog() {
            if (!this._oMpsRunIdDialog) {
                const oMpsRunIdModel = new JSONModel({ items: [] });

                this._oMpsRunIdDialog = new sap.m.Dialog({
                    title: "MPS 실행 ID 검색",
                    contentWidth: "60rem",
                    afterClose: () => {
                        // 다이얼로그 닫힐 때 SearchField 초기화
                        const oSF = this._oMpsRunIdDialog.getContent()[0];
                        oSF.setValue("");
                    },
                    content: [
                        new sap.m.SearchField({
                            id: "mpsRunIdSearchField",
                            placeholder: "MPS 실행 ID 검색...",
                            search: this._onMpsRunIdSearch.bind(this)
                        }),
                        new sap.m.Table({
                            columns: [
                                new sap.m.Column({ header: new sap.m.Text({ text: "MPS 실행 ID" }) }),
                                new sap.m.Column({ header: new sap.m.Text({ text: "플랜트" }) }),
                                new sap.m.Column({ header: new sap.m.Text({ text: "플랜트명" }) }),
                                new sap.m.Column({ header: new sap.m.Text({ text: "자재코드" }) }),
                                new sap.m.Column({ header: new sap.m.Text({ text: "자재명" }) }),
                                new sap.m.Column({ header: new sap.m.Text({ text: "계획 시작일" }) }),
                                new sap.m.Column({ header: new sap.m.Text({ text: "계획 종료일" }) })
                            ],
                            items: {
                                path: "mpsRunIdModel>/items",
                                template: new sap.m.ColumnListItem({
                                    type: "Active",
                                    press: this._onMpsRunIdSelect.bind(this),
                                    cells: [
                                        new sap.m.Text({ text: "{mpsRunIdModel>RunId}" }),
                                        new sap.m.Text({ text: "{mpsRunIdModel>Werks}" }),
                                        new sap.m.Text({ text: "{mpsRunIdModel>PlantName}" }),
                                        new sap.m.Text({ text: "{mpsRunIdModel>Matnr}" }),
                                        new sap.m.Text({ text: "{mpsRunIdModel>Maktx}" }),
                                        // 날짜: formatter 적용 → yyyy.MM.dd 형식
                                        new sap.m.Text({
                                            text: {
                                                path: "mpsRunIdModel>PlanStartDate",
                                                formatter: this.formatter.formatDate
                                            }
                                        }),
                                        new sap.m.Text({
                                            text: {
                                                path: "mpsRunIdModel>PlanEndDate",
                                                formatter: this.formatter.formatDate
                                            }
                                        })
                                    ]
                                })
                            }
                        })
                    ],
                    buttons: [
                        new sap.m.Button({
                            text: "취소",
                            press: () => this._oMpsRunIdDialog.close()
                        })
                    ]
                });

                this._oMpsRunIdDialog.setModel(oMpsRunIdModel, "mpsRunIdModel");
                this.getView().addDependent(this._oMpsRunIdDialog);
            }
            const oSearchField = sap.ui.getCore().byId("mpsRunIdSearchField");
            if (oSearchField) {
                oSearchField.setValue("");
            }
            this._oMpsRunIdDialog.open();
            this._loadMpsRunIdList();  // 오픈 시 전체조회
        },

        _loadMpsRunIdList(sKeyword) {
            const oModel = this.getOwnerComponent().getModel();
            const aFilters = [];

            if (sKeyword) {
                aFilters.push(new Filter("RunId", FilterOperator.Contains, sKeyword));
            }

            oModel.read("/MpsRunIdSet", {
                filters: aFilters,
                groupId: "$direct",
                success: (oData) => {
                    this._oMpsRunIdDialog.getModel("mpsRunIdModel")
                        .setProperty("/items", oData.results);
                },
                error: (oError) => {
                    let sMessage = "MPS 실행 ID 조회 중 오류가 발생했습니다.";
                    try {
                        sMessage = JSON.parse(oError.responseText).error.message.value;
                    } catch (e) { }
                    MessageBox.error(sMessage);
                }
            });
        },

        _onMpsRunIdSearch(oEvent) {
            const sQuery = oEvent.getParameter("query") || "";
            this._loadMpsRunIdList(sQuery || undefined);
        },

        _onMpsRunIdSelect(oEvent) {
            const oItem = oEvent.getSource().getBindingContext("mpsRunIdModel");
            const sRunId = oItem.getProperty("RunId");
            const oViewModel = this.getView().getModel("viewModel");

            // From/To 구분해서 세팅
            if (this._sMpsRunIdTarget === "To") {
                oViewModel.setProperty("/searchRunIdTo", sRunId);
            } else {
                oViewModel.setProperty("/searchRunIdFrom", sRunId);
            }
            this._oMpsRunIdDialog.close();
        },

        // i18n 텍스트 헬퍼 함수
        _i18n(sKey) {
            return this.getView().getModel("i18n").getResourceBundle().getText(sKey);
        }
    });
});