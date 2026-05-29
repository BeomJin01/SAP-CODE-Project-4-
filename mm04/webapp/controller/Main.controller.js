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

            // statusData:     차트1 — 확정포함/승인대기/계획취소 건수 (Donut)
            // statusMatnrData: 차트2 — 자재별 AP/WA/CN/RJ 아이템 건수 (Stacked Bar)
            // matnrData:      차트3 — 자재별 MPS 개시량 합계 (Bar)
            // fcstOrderData:  차트4 — 주차별 예측수요 vs 수주 전체 합산 (Column)
            const oDashModel = new JSONModel({
                statusData: [],
                statusMatnrData: [],
                matnrData: [],
                fcstOrderData: []
            });

            this.getView().setModel(oDashModel, "dashModel");
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

            // OData DateTime 리터럴로 전달 (UTC 시차 보정 포함)
            // KST(+9) → UTC 변환 시 9시간 빠르게 전달되므로 9시간 더해서 보정
            const fnDateOData = (oDate) => {
                // 선택한 날짜의 자정(00:00:00 KST) = UTC+9이므로
                // UTC 기준으로는 전날 15:00:00이 됨
                // → 9시간(32400000ms)을 더해 날짜 보정
                const iOffset = oDate.getTimezoneOffset() * 60 * 1000; // 음수 (KST: -540분 → +540분 보정)
                return new Date(oDate.getTime() - iOffset);
            };

            if (oStartFrom) {
                aFilters.push(new Filter("PlanStartDate", FilterOperator.GE, fnDateOData(oStartFrom)));
            }
            if (oStartTo) {
                aFilters.push(new Filter("PlanStartDate", FilterOperator.LE, fnDateOData(oStartTo)));
            }
            if (oEndFrom) {
                aFilters.push(new Filter("PlanEndDate", FilterOperator.GE, fnDateOData(oEndFrom)));
            }
            if (oEndTo) {
                aFilters.push(new Filter("PlanEndDate", FilterOperator.LE, fnDateOData(oEndTo)));
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

                    // -------------------------------------------------------
                    // 대시보드 데이터 갱신
                    // 조회 결과(aItems) 기반으로 차트 4종 데이터 재계산
                    // → 조회할 때마다 항상 최신 데이터로 대시보드 갱신
                    // -------------------------------------------------------
                    this._updateDashboard(aItems);

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

            // -------------------------------------------------------
            // 대시보드 초기화
            // 조회 조건 초기화 시 대시보드도 빈 상태로 되돌림
            // vboxDashNoData: 안내 메시지 표시
            // vboxDashboard:  차트 영역 숨김
            // dashModel: 모든 차트 데이터 빈 배열로 초기화
            // -------------------------------------------------------
            this.getView().getModel("dashModel").setData({
                statusData: [],
                statusMatnrData: [],
                matnrData: [],
                fcstOrderData: []
            });
            this.getView().byId("vboxDashNoData").setVisible(true);
            this.getView().byId("vboxDashboard").setVisible(false);

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

        // -------------------------------------------------------
        // 메인 탭 전환 이벤트
        // 탭2(대시보드) 진입 시 현재 조회 데이터 기준으로
        // 차트 표시 여부 결정
        // -------------------------------------------------------
        onMainTabSelect(oEvent) {
            const sKey = oEvent.getParameter("selectedKey");
            if (sKey === "tabMainDashboard") {
                // 대시보드 탭 진입 시 현재 테이블 데이터 확인
                const aItems = this.getView().getModel("mainTableModel")
                    .getProperty("/items");
                if (aItems && aItems.length > 0) {
                    // 조회된 데이터 있으면 차트 표시
                    this.getView().byId("vboxDashNoData").setVisible(false);
                    this.getView().byId("vboxDashboard").setVisible(true);
                } else {
                    // 조회된 데이터 없으면 빈 상태 안내 표시
                    this.getView().byId("vboxDashNoData").setVisible(true);
                    this.getView().byId("vboxDashboard").setVisible(false);
                }
            }
        },

        // 새로고침
        onRefresh() {
            this.onSearch();
            MessageToast.show("새로고침 되었습니다.");
        },

        // -------------------------------------------------------
        // 대시보드 데이터 가공 및 차트 업데이트
        // MpsRunSet 조회 결과(aItems)를 기반으로
        // 차트1(상태별 건수) 즉시 계산
        // 차트2(자재별 결과 현황), 차트3(자재별 개시량),
        // 차트4(주차별 예측수요 vs 수주)는 MpsResultSet 별도 조회 후 계산
        // -------------------------------------------------------
        _updateDashboard(aItems) {
            const oDashModel = this.getView().getModel("dashModel");

            // 데이터 없으면 빈 상태로 초기화
            if (!aItems || aItems.length === 0) {
                oDashModel.setData({
                    statusData: [],
                    statusMatnrData: [],
                    matnrData: [],
                    fcstOrderData: []
                });
                this.getView().byId("vboxDashNoData").setVisible(true);
                this.getView().byId("vboxDashboard").setVisible(false);
                return;
            }

            // -------------------------------------------------------
            // 차트1: MPS 실행 현황 (Donut)
            // MpsRunSet 기준 상태상세 분류
            // 확정포함: Status=EC + EarliestWaDate 없음
            // 승인대기: Status=EC + EarliestWaDate 있음
            // 계획취소: Status=EF 또는 CN
            // -------------------------------------------------------
            const oStatusMap = {
                "확정포함": 0,
                "승인대기": 0,
                "계획취소": 0
            };
            aItems.forEach(item => {
                if (item.Status === "EC" && !item.EarliestWaDate) {
                    oStatusMap["확정포함"]++;
                } else if (item.Status === "EC" && !!item.EarliestWaDate) {
                    oStatusMap["승인대기"]++;
                } else {
                    // EF 또는 CN
                    oStatusMap["계획취소"]++;
                }
            });
            // 건수 0인 항목은 Donut에서 제외
            const aStatusData = Object.entries(oStatusMap)
                .filter(([, v]) => v > 0)
                .map(([k, v]) => ({ StatusText: k, Count: v }));

            oDashModel.setProperty("/statusData", aStatusData);

            // 차트1 vizProperties 설정
            const oVizStatus = this.getView().byId("vizDashStatus");
            if (oVizStatus) {
                oVizStatus.setVizProperties({
                    title: { visible: false },
                    interaction: {
                        selectability: { mode: "NONE" }
                    }
                });
            }

            // 차트2~4는 MpsResultSet 별도 조회 필요
            this._loadDashboardResultData(aItems);

            // 대시보드 차트 영역 표시
            this.getView().byId("vboxDashNoData").setVisible(false);
            this.getView().byId("vboxDashboard").setVisible(true);
        },

        // -------------------------------------------------------
        // 차트2(자재별 결과 현황), 차트3(자재별 MPS 개시량),
        // 차트4(주차별 예측수요 vs 수주)를 위한 MpsResultSet 조회
        // -------------------------------------------------------
        _loadDashboardResultData(aItems) {
            const oModel = this.getOwnerComponent().getModel();
            const oDashModel = this.getView().getModel("dashModel");

            // 중복 제거한 RunId 목록
            const aRunIds = [...new Set(aItems.map(item => item.MpsRunId))];

            // -------------------------------------------------------
            // URL 길이 제한 대응: RunId를 5개씩 배치로 나눠 순차 조회
            // 모든 배치 완료 후 결과 합산하여 차트 데이터 계산
            // -------------------------------------------------------
            const iBatchSize = 5;
            const aBatches = [];
            for (let i = 0; i < aRunIds.length; i += iBatchSize) {
                aBatches.push(aRunIds.slice(i, i + iBatchSize));
            }

            // 모든 배치 결과를 누적할 배열
            let aAllResults = [];

            // 배치 순차 실행 함수 (재귀 방식)
            const fnProcessBatch = (iBatchIndex) => {
                if (iBatchIndex >= aBatches.length) {
                    // 모든 배치 완료 → 차트 데이터 계산
                    this._calcDashboardCharts(oDashModel, aAllResults);
                    return;
                }

                const aBatch = aBatches[iBatchIndex];
                const aFilters = aBatch.map(id =>
                    new Filter("MpsRunId", FilterOperator.EQ, id)
                );
                const oCombinedFilter = new Filter({
                    filters: aFilters,
                    and: false
                });

                oModel.read("/MpsResultSet", {
                    filters: [oCombinedFilter],
                    success: (oData) => {
                        // 배치 결과 누적
                        aAllResults = aAllResults.concat(oData.results);
                        // 다음 배치 처리
                        fnProcessBatch(iBatchIndex + 1);
                    },
                    error: (oError) => {
                        let sMessage = "대시보드 데이터 조회 중 오류가 발생했습니다.";
                        try {
                            sMessage = JSON.parse(oError.responseText)
                                .error.message.value;
                        } catch (e) { }
                        MessageBox.error(sMessage);
                    }
                });
            };

            // 첫 번째 배치부터 시작
            fnProcessBatch(0);
        },

        // -------------------------------------------------------
        // 배치 조회 완료 후 차트2~4 데이터 계산
        // _loadDashboardResultData에서 분리하여 가독성 향상
        // -------------------------------------------------------
        _calcDashboardCharts(oDashModel, aResults) {

            const oView = this.getView();

            // -------------------------------------------------------
            // 차트2: MPS 결과 현황 (Stacked Bar)
            // 자재별 AP/WA/CN/RJ 아이템 행 건수 집계
            // -------------------------------------------------------
            const oStatusMatnrMap = {};
            aResults.forEach(item => {
                const sMatnr = item.Matnr;
                if (!oStatusMatnrMap[sMatnr]) {
                    oStatusMatnrMap[sMatnr] = {
                        Matnr: sMatnr,
                        ApCount: 0,
                        WaCount: 0,
                        CnCount: 0,
                        RjCount: 0
                    };
                }
                switch (item.Status) {
                    case "AP": oStatusMatnrMap[sMatnr].ApCount++; break;
                    case "WA": oStatusMatnrMap[sMatnr].WaCount++; break;
                    case "CN": oStatusMatnrMap[sMatnr].CnCount++; break;
                    case "RJ": oStatusMatnrMap[sMatnr].RjCount++; break;
                }
            });
            const aStatusMatnrData = Object.values(oStatusMatnrMap)
                .sort((a, b) =>
                    (b.ApCount + b.WaCount + b.CnCount + b.RjCount) -
                    (a.ApCount + a.WaCount + a.CnCount + a.RjCount)
                );

            // -------------------------------------------------------
            // 차트3: 자재별 MPS 개시량 합계 (Bar)
            // -------------------------------------------------------
            const oMatnrMap = {};
            aResults.forEach(item => {
                const sKey = item.Matnr;
                if (!oMatnrMap[sKey]) {
                    oMatnrMap[sKey] = { Matnr: sKey, TotalRelQty: 0 };
                }
                oMatnrMap[sKey].TotalRelQty +=
                    parseFloat(item.MpsRelQty) || 0;
            });
            const aMatnrData = Object.values(oMatnrMap)
                .sort((a, b) => b.TotalRelQty - a.TotalRelQty);

            // -------------------------------------------------------
            // 차트4 원본 데이터 구성
            // 주차 대표일(PlanDate) 기준으로 집계
            // 자재별 수량도 함께 보관 (툴팁용)
            // -------------------------------------------------------
            const oFcstOrderMap = {};
            aResults.forEach(item => {
                // BucketNo 기준으로 키 생성 (정렬용)
                const iBucket = parseInt(item.BucketNo);
                const sKey = String(iBucket).padStart(3, "0"); // "001", "002" ... 정렬용
                const sMatnr = item.Matnr;

                if (!oFcstOrderMap[sKey]) {
                    oFcstOrderMap[sKey] = {
                        BucketNo: iBucket,
                        PlanDate: item.PlanDate || "",   // 주차 대표일 (Edm.DateTime)
                        TotalFcstQty: 0,
                        TotalOrderQty: 0,
                        MatnrFcst: {},   // 자재별 예측수요량 { MATNR: qty }
                        MatnrOrder: {}   // 자재별 주문량     { MATNR: qty }
                    };
                }
                oFcstOrderMap[sKey].TotalFcstQty += parseFloat(item.FcstQty) || 0;
                oFcstOrderMap[sKey].TotalOrderQty += parseFloat(item.OrderQty) || 0;

                // 자재별 수량 누적
                if (!oFcstOrderMap[sKey].MatnrFcst[sMatnr]) {
                    oFcstOrderMap[sKey].MatnrFcst[sMatnr] = 0;
                }
                if (!oFcstOrderMap[sKey].MatnrOrder[sMatnr]) {
                    oFcstOrderMap[sKey].MatnrOrder[sMatnr] = 0;
                }
                oFcstOrderMap[sKey].MatnrFcst[sMatnr] += parseFloat(item.FcstQty) || 0;
                oFcstOrderMap[sKey].MatnrOrder[sMatnr] += parseFloat(item.OrderQty) || 0;
            });

            // 정렬
            const aFcstOrderRaw = Object.values(oFcstOrderMap)
                .sort((a, b) => a.BucketNo - b.BucketNo);

            // 최대 주차 수 확인 → 20주차 초과 여부 판단
            const iMaxBucket = aFcstOrderRaw.length > 0
                ? aFcstOrderRaw[aFcstOrderRaw.length - 1].BucketNo
                : 0;
            const bOverLimit = iMaxBucket > 20;

            // 원본 데이터를 모델에 저장 (월별/주차별 전환 시 재사용)
            // _this._aFcstOrderRaw 에 캐싱
            this._aFcstOrderRaw = aFcstOrderRaw;
            this._bFcstOverLimit = bOverLimit;

            const oCbWeekly = oView.byId("rbFcstWeekly");
            const oCbMonthly = oView.byId("rbFcstMonthly");
            const oVboxOverLimit = oView.byId("vboxFcstOverLimit");
            const oVizFcst = oView.byId("vizDashFcstOrder");
            const oPopoverFcst = oView.byId("vizPopoverFcst");
            // HBox(라디오버튼 영역)도 12주 초과 시 숨김
            const oHboxFcstRadio = oView.byId("hboxFcstRadio");  // ← View에서 id 추가 필요 (아래 참고)

            if (bOverLimit) {
                if (oHboxFcstRadio) oHboxFcstRadio.setVisible(true);
                if (oCbWeekly) { oCbWeekly.setSelected(false); }   // ← setEnabled(false) 제거
                if (oCbMonthly) { oCbMonthly.setSelected(true); }
                if (oVboxOverLimit) oVboxOverLimit.setVisible(false);
                if (oVizFcst) oVizFcst.setVisible(true);
                if (oPopoverFcst) oPopoverFcst.setVisible(true);
                this._renderFcstChart(false);
            } else {
                if (oHboxFcstRadio) oHboxFcstRadio.setVisible(true);
                if (oVboxOverLimit) oVboxOverLimit.setVisible(false);
                if (oVizFcst) oVizFcst.setVisible(true);
                if (oPopoverFcst) oPopoverFcst.setVisible(true);
                if (oCbWeekly) { oCbWeekly.setSelected(true); }    // ← setEnabled(true) 제거
                if (oCbMonthly) { oCbMonthly.setSelected(false); }
                this._renderFcstChart(true);
            }

            // 차트2, 차트3 데이터 세팅
            oDashModel.setProperty("/statusMatnrData", aStatusMatnrData);
            oDashModel.setProperty("/matnrData", aMatnrData);

            // -------------------------------------------------------
            // 차트2·3 동적 높이 계산
            // 자재 1개당 30px 기준으로 높이 계산
            // 최소 500px 보장, 상한 없음 (CSS max-height로 스크롤 제어)
            // -------------------------------------------------------
            const iBarHeight = 30;    // 자재 1개당 픽셀
            const iMinHeight = 300;   // 최소 높이 (px)
            const iMaxHeight = 300;   // ScrollContainer 최대 높이 (px) — 초과 시 스크롤 발생
            const iHeaderPad = 80;    // 차트 상하 여백

            // 차트2 실제 콘텐츠 높이 계산
            const iChart2Content = Math.max(
                iMinHeight,
                aStatusMatnrData.length * iBarHeight + iHeaderPad
            );
            // 차트3 실제 콘텐츠 높이 계산
            const iChart3Content = Math.max(
                iMinHeight,
                aMatnrData.length * iBarHeight + iHeaderPad
            );

            // 차트2 (Stacked Bar): ScrollContainer 내 VizFrame 높이 동적 세팅
            const oVizChart2 = oView.byId("vizDashStatusMatnr");
            if (oVizChart2) oVizChart2.setHeight(iChart2Content + "px");

            // 차트4 (자재별 Bar): ScrollContainer 없으므로 VizFrame 높이를 직접 동적 세팅
            // iChart3Content = 자재 수 × 30px + 여백 80px
            const oVizChart4 = oView.byId("vizDashMatnr");
            if (oVizChart4) oVizChart4.setHeight(iChart3Content + "px");

            // 차트2 ScrollContainer 높이 유지
            const oScrollChart2 = oView.byId("scrollChart2");
            if (oScrollChart2) {
                oScrollChart2.setHeight(iMaxHeight + "px");
            }

            // 차트1 (Donut)
            const oVizStatus = oView.byId("vizDashStatus");
            if (oVizStatus) {
                oVizStatus.setVizProperties({
                    title: { visible: false },
                    interaction: { selectability: { mode: "NONE" } },
                    plotArea: {
                        dataLabel: {
                            visible: true,
                            type: "value",          // 값(숫자) 표시
                            formatString: "#,##0"
                        }
                    }
                });
            }

            // 차트2 (Stacked Bar)
            // reversedDirection: 합계 높은 자재가 위에 표시
            // position "top": 숫자 눈금을 차트 상단으로 이동
            // valueAxis title false: "승인완료 & 승인대기 & ..." 하단 레이블 제거
            const oVizStatusMatnr = oView.byId("vizDashStatusMatnr");
            if (oVizStatusMatnr) {
                oVizStatusMatnr.setVizProperties({
                    title: { visible: false },
                    interaction: { selectability: { mode: "NONE" } },
                    categoryAxis: {
                        title: { visible: false },
                        reversedDirection: true
                    },
                    valueAxis: {
                        title: { visible: false }
                    },
                    plotArea: {
                        dataLabel: {
                            visible: true,
                            formatString: "#,##0",
                            hideWhenOverlap: true
                        }
                    }
                });
            }

            // 차트3 (Bar)
            // reversedDirection: 개시량 높은 자재가 위에 표시
            // position "top": 숫자 눈금을 차트 상단으로 이동
            // valueAxis title false: "MPS개시량합계" 하단 레이블 제거
            const oVizMatnr = oView.byId("vizDashMatnr");
            if (oVizMatnr) {
                oVizMatnr.setVizProperties({
                    title: { visible: false },
                    interaction: { selectability: { mode: "NONE" } },
                    categoryAxis: {
                        title: { visible: false },
                        reversedDirection: true
                    },
                    valueAxis: {
                        title: { visible: false }
                    },
                    plotArea: {
                        dataLabel: {
                            visible: true,
                            formatString: "#,##0",
                            hideWhenOverlap: true
                        }
                    }
                });

                // X축에 여유를 주어 레이블이 잘리지 않게 함
                const iMaxRelQty = aMatnrData.length > 0
                    ? Math.max(...aMatnrData.map(d => d.TotalRelQty))
                    : 0;
                if (iMaxRelQty > 0) {
                    // 눈금 간격 계산: 최댓값 기준 적절한 단위 선택
                    // 예: 450 → 단위 100 → 다음 눈금 500
                    //     75  → 단위 25  → 다음 눈금 100
                    const aTickUnits = [1, 2, 5, 10, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
                    // 전체를 5개 눈금으로 나눌 때 적합한 단위 찾기
                    const iRoughUnit = iMaxRelQty / 5;
                    const iTickUnit = aTickUnits.find(u => u >= iRoughUnit) || 1000;
                    // 현재 최댓값을 단위로 올림한 다음 한 칸 더 추가
                    const iMaxScale = Math.ceil(iMaxRelQty / iTickUnit) * iTickUnit + iTickUnit;

                    oVizMatnr.setVizScales([{
                        feed: "valueAxis",
                        max: iMaxScale
                    }], { replace: true });
                }
            }

        },

        // -------------------------------------------------------
        // 차트4 주차별/월별 체크박스 전환 이벤트
        // 두 체크박스는 상호 배타적으로 동작
        // -------------------------------------------------------
        onFcstViewToggle(oEvent) {
            const oSource = oEvent.getSource();
            const oView = this.getView();
            const oRbWeekly = oView.byId("rbFcstWeekly");
            const oRbMonthly = oView.byId("rbFcstMonthly");
            const oVboxOverLimit = oView.byId("vboxFcstOverLimit");
            const oVizFcst = oView.byId("vizDashFcstOrder");
            const oPopoverFcst = oView.byId("vizPopoverFcst");

            const bClickedWeekly = oSource === oRbWeekly;

            // RadioButton 수동 배타 처리 (groupName 없으므로)
            if (bClickedWeekly) {
                oRbWeekly.setSelected(true);
                oRbMonthly.setSelected(false);
            } else {
                oRbWeekly.setSelected(false);
                oRbMonthly.setSelected(true);
            }

            if (bClickedWeekly && this._bFcstOverLimit) {
                // 12주 초과: 주차별 불가 → IllustratedMessage 표시, 차트 숨김
                if (oVboxOverLimit) oVboxOverLimit.setVisible(true);
                if (oVizFcst) oVizFcst.setVisible(false);
                if (oPopoverFcst) oPopoverFcst.setVisible(false);
            } else {
                // 그 외 모든 경우: 차트 표시
                if (oVboxOverLimit) oVboxOverLimit.setVisible(false);
                if (oVizFcst) oVizFcst.setVisible(true);
                if (oPopoverFcst) oPopoverFcst.setVisible(true);
                this._renderFcstChart(bClickedWeekly);
            }
        },

        // -------------------------------------------------------
        // 차트4 렌더링: 주차별(bWeekly=true) / 월별(bWeekly=false)
        // _aFcstOrderRaw 캐시 데이터를 가공하여 dashModel에 세팅
        // -------------------------------------------------------
        _renderFcstChart(bWeekly) {
            if (!this._aFcstOrderRaw) return;

            const oDashModel = this.getView().getModel("dashModel");
            let aFcstOrderData = [];

            if (bWeekly) {
                // -------------------------------------------------------
                // 주차별 모드: 주차 대표일을 X축 레이블로 사용
                // PlanDate(Edm.DateTime) → yyyy.MM.dd 포맷
                // -------------------------------------------------------
                aFcstOrderData = this._aFcstOrderRaw.map(item => {
                    // 날짜 포맷: yyyy.MM.dd
                    let sPeriodLabel = "";
                    if (item.PlanDate) {
                        const oDateFormat = sap.ui.core.format.DateFormat
                            .getDateInstance({ pattern: "MM.dd" });
                        sPeriodLabel = oDateFormat.format(item.PlanDate);
                    }
                    return {
                        PeriodLabel: sPeriodLabel || `W${String(item.BucketNo).padStart(2, "0")}`,
                        TotalFcstQty: Math.round(item.TotalFcstQty),
                        TotalOrderQty: Math.round(item.TotalOrderQty),
                        MatnrFcst: item.MatnrFcst,
                        MatnrOrder: item.MatnrOrder
                    };
                });

            } else {
                // -------------------------------------------------------
                // 월별 모드: PlanDate 기준으로 yyyy.MM 으로 묶어 합산
                // -------------------------------------------------------
                const oMonthMap = {};
                this._aFcstOrderRaw.forEach(item => {
                    let sMonthKey = "";
                    if (item.PlanDate) {
                        const oDateFormat = sap.ui.core.format.DateFormat
                            .getDateInstance({ pattern: "yyyy.MM" });
                        sMonthKey = oDateFormat.format(item.PlanDate);
                    }
                    if (!sMonthKey) return;

                    if (!oMonthMap[sMonthKey]) {
                        oMonthMap[sMonthKey] = {
                            PeriodLabel: sMonthKey,
                            TotalFcstQty: 0,
                            TotalOrderQty: 0,
                            MatnrFcst: {},
                            MatnrOrder: {}
                        };
                    }
                    oMonthMap[sMonthKey].TotalFcstQty += item.TotalFcstQty;
                    oMonthMap[sMonthKey].TotalOrderQty += item.TotalOrderQty;

                    // 자재별 합산
                    Object.entries(item.MatnrFcst).forEach(([sMatnr, fQty]) => {
                        oMonthMap[sMonthKey].MatnrFcst[sMatnr] =
                            (oMonthMap[sMonthKey].MatnrFcst[sMatnr] || 0) + fQty;
                    });
                    Object.entries(item.MatnrOrder).forEach(([sMatnr, fQty]) => {
                        oMonthMap[sMonthKey].MatnrOrder[sMatnr] =
                            (oMonthMap[sMonthKey].MatnrOrder[sMatnr] || 0) + fQty;
                    });
                });

                aFcstOrderData = Object.values(oMonthMap)
                    .sort((a, b) => a.PeriodLabel.localeCompare(b.PeriodLabel))
                    .map(item => ({
                        ...item,
                        TotalFcstQty: Math.round(item.TotalFcstQty),
                        TotalOrderQty: Math.round(item.TotalOrderQty)
                    }));
            }

            oDashModel.setProperty("/fcstOrderData", aFcstOrderData);

            const oVizFcstOrder = this.getView().byId("vizDashFcstOrder");
            if (!oVizFcstOrder) return;

            const aAllMatnrs = aFcstOrderData.length > 0
                ? Object.keys(aFcstOrderData[0].MatnrFcst)
                : [];
            const iMatnrCount = aAllMatnrs.length;

            // -------------------------------------------------------
            // Popover 연결 (호버 시 기본 툴팁 표시)
            // -------------------------------------------------------
            const oPopover = this.getView().byId("vizPopoverFcst");
            if (oPopover) {
                oPopover.connect(oVizFcstOrder.getVizUid());
            }

            // -------------------------------------------------------
            // vizProperties 설정
            // EXCLUSIVE: 클릭 이벤트(attachSelectData)가 발동하려면 NONE이 아닌 EXCLUSIVE 필요
            // -------------------------------------------------------
            oVizFcstOrder.setVizProperties({
                title: { visible: false },
                interaction: {
                    selectability: { mode: "NONE" }
                },
                plotArea: {
                    dataLabel: {
                        visible: true,
                        formatString: "#,##0",
                        hideWhenOverlap: false,
                        position: "outside"
                    }
                }
            });
        },

        // -------------------------------------------------------
        // 차트4 툴팁 텍스트 생성
        // 자재 5개 이하: 전체 자재별 수량 + 합계
        // 자재 5개 초과: 상위 5개 + 기타 + 합계
        // -------------------------------------------------------
        _buildFcstTooltip(oData, aFcstOrderData, sMatnrKey, iMatnrCount) {
            const sPeriod = oData && oData["기간"];
            if (!sPeriod) return { text: "", total: 0 };

            const oItem = aFcstOrderData.find(d => d.PeriodLabel === sPeriod);
            if (!oItem) return { text: "", total: 0 };

            const oMatnrMap = oItem[sMatnrKey] || {};

            // 수량 기준 내림차순 정렬
            const aSorted = Object.entries(oMatnrMap)
                .map(([sMatnr, fQty]) => ({ Matnr: sMatnr, Qty: Math.round(fQty) }))
                .sort((a, b) => b.Qty - a.Qty);

            const iTotalQty = aSorted.reduce((sum, item) => sum + item.Qty, 0);

            let sResult = "";

            if (aSorted.length <= 5) {
                aSorted.forEach(item => {
                    sResult += `${item.Matnr}: ${item.Qty.toLocaleString()}\n`;
                });
            } else {
                const aTop5 = aSorted.slice(0, 5);
                const iEtcQty = aSorted.slice(5)
                    .reduce((sum, item) => sum + item.Qty, 0);
                aTop5.forEach(item => {
                    sResult += `${item.Matnr}: ${item.Qty.toLocaleString()}\n`;
                });
                // '기타' → '그 외'
                sResult += `그 외: ${iEtcQty.toLocaleString()}\n`;
            }

            // 구분선·합계 제거, 합계는 반환값으로 별도 전달
            return { text: sResult.trimEnd(), total: iTotalQty };
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