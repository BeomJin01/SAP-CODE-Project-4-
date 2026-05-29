sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/core/routing/History",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageBox",
    "code/t4/ui5/mm04/model/formatter"
], (Controller, History, JSONModel, Filter, FilterOperator, MessageBox, formatter) => {
    "use strict";

    return Controller.extend("code.t4.ui5.mm04.controller.Detail", {

        // formatter 참조 (View XML에서 .formatter.xxx 형태로 사용)
        formatter: formatter,

        onInit() {
            // 헤더 정보 모델 초기화
            const oDetailModel = new JSONModel({});
            this.getView().setModel(oDetailModel, "detailModel");

            // 아이템 테이블 모델 초기화
            const oItemTableModel = new JSONModel({ items: [] });
            this.getView().setModel(oItemTableModel, "itemTableModel");

            // 차트 데이터 모델 초기화
            const oChartModel = new JSONModel({
                items: [],        // 원본 전체 데이터 (8개 항목 모두 포함)
                displayItems: [], // 차트에 실제 표시되는 데이터 (체크된 항목만)
                // 레이블 표시 여부: Switch ON/OFF 상태
                // true = 레이블 표시, false = 레이블 숨김
                showLabel: true,
                visibility: {
                    // 초기값: 모두 체크된 상태
                    FcstQty: false, // 예측수요량 (Bar) — 기본 비활성
                    OrderQty: false, // 주문량     (Bar) — 기본 비활성
                    MpsQty: true,  // MPS수량    (Bar) — 기본 활성
                    MpsRelQty: true,  // MPS개시량  (Bar) — 기본 활성
                    SafetyStockQty: true,  // 안전재고량 (Bar) — 기본 활성
                    ProjectedAvailQty: true,  // 예상재고량 (Line) — 기본 활성
                    AtpQty: false, // ATP수량    (Line) — 기본 비활성
                    BaseQty: true   // 기준수요량 (Line) — 기본 활성
                }
            });
            this.getView().setModel(oChartModel, "chartModel");

            // 라우터 RouteDetail 패턴 매칭 시 _onRouteMatched 호출
            const oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("RouteDetail").attachPatternMatched(this._onRouteMatched, this);

        },

        _onRouteMatched(oEvent) {
            // URL에서 mpsRunId 추출
            // Main에서 encodeURIComponent로 넘겼으므로 decode 필요
            const sMpsRunId = decodeURIComponent(
                oEvent.getParameter("arguments").mpsRunId
            );
            this._sMpsRunId = sMpsRunId;

            // 모델 초기화 (이전 데이터 클리어)
            this.getView().getModel("detailModel").setData({});
            this.getView().getModel("itemTableModel").setProperty("/items", []);
            this.getView().getModel("chartModel").setProperty("/items", []);
            this.getView().byId("txtItemCount").setText("MPS 계획 아이템: 0건");

            // 탭 항상 첫 번째(결과상세)로 초기화
            this.getView().byId("detailTabBar").setSelectedKey("tabResult");

            // 헤더 + 아이템 로드
            this._loadHeader(sMpsRunId);
            this._loadItems(sMpsRunId);
        },

        // -------------------------------------------------------
        // 헤더 단건 조회: MpsRunSet('{MpsRunId}')
        // GET_ENTITY 메소드 호출 → ZTD4MM0009 단건 + 조인 데이터
        // -------------------------------------------------------
        _loadHeader(sMpsRunId) {
            const oModel = this.getOwnerComponent().getModel();
            const oDetailModel = this.getView().getModel("detailModel");

            // OData 단건 조회 경로
            // MpsRunSet의 Key는 MpsRunId (문자열) → 따옴표 필요
            const sPath = `/MpsRunSet('${encodeURIComponent(sMpsRunId)}')`;

            oModel.read(sPath, {
                success: (oData) => {
                    // 응답 데이터 전체를 detailModel에 세팅
                    oDetailModel.setData(oData);
                },
                error: (oError) => {
                    let sMessage = "헤더 정보 조회 중 오류가 발생했습니다.";
                    try {
                        sMessage = JSON.parse(oError.responseText).error.message.value;
                    } catch (e) { }
                    MessageBox.error(sMessage);
                }
            });
        },

        // -------------------------------------------------------
        // 아이템 목록 조회: MpsResultSet?$filter=MpsRunId eq '{id}'
        // GET_ENTITYSET 메소드 호출 → ZTD4MM0010 목록
        // -------------------------------------------------------
        _loadItems(sMpsRunId) {
            const oModel = this.getOwnerComponent().getModel();
            const oItemTableModel = this.getView().getModel("itemTableModel");
            const oChartModel = this.getView().getModel("chartModel");

            oModel.read("/MpsResultSet", {
                filters: [
                    new Filter("MpsRunId", FilterOperator.EQ, sMpsRunId)
                ],
                success: (oData) => {
                    const aItems = oData.results;

                    // 탭1: 아이템 테이블 데이터 세팅
                    oItemTableModel.setProperty("/items", aItems);

                    // 건수 업데이트
                    this.getView().byId("txtItemCount")
                        .setText(`MPS 계획 아이템: ${aItems.length}건`);

                    // 탭2: 차트 데이터 가공
                    // BucketNo → "W01", "W02" 형태 WeekLabel 생성
                    // 수량 필드는 parseFloat으로 숫자 변환 (문자열 방지)
                    const aChartItems = aItems.map(item => {
                        const fFcstQty = parseFloat(item.FcstQty) || 0;
                        const fOrderQty = parseFloat(item.OrderQty) || 0;
                        return {
                            WeekLabel: `W${String(item.BucketNo).padStart(2, "0")}`,
                            FcstQty: fFcstQty,
                            OrderQty: fOrderQty,
                            MpsQty: parseFloat(item.MpsQty) || 0,
                            MpsRelQty: parseFloat(item.MpsRelQty) || 0,
                            SafetyStockQty: parseFloat(item.SafetyStockQty) || 0,
                            ProjectedAvailQty: parseFloat(item.ProjectedAvailQty) || 0,
                            AtpQty: parseFloat(item.AtpQty) || 0,
                            // 기준수요량: max(예측수요량, 주문량)
                            BaseQty: Math.max(fFcstQty, fOrderQty)
                        };
                    });

                    // 원본 데이터 저장
                    oChartModel.setProperty("/items", aChartItems);

                    // 초기 displayItems 세팅 및 FeedItem 업데이트
                    this._updateChart();

                },
                error: (oError) => {
                    let sMessage = "아이템 조회 중 오류가 발생했습니다.";
                    try {
                        sMessage = JSON.parse(oError.responseText).error.message.value;
                    } catch (e) { }
                    MessageBox.error(sMessage);
                }
            });
        },

        // -------------------------------------------------------
        // 체크박스 토글 이벤트
        // 체크박스 상태 변경 시 차트 데이터 및 FeedItem 재구성
        // -------------------------------------------------------
        onSeriesToggle() {
            this._updateChart();
        },

        // -------------------------------------------------------
        // Switch 토글 이벤트
        // Switch ON/OFF 변경 시 차트 레이블 표시/숨김
        // -------------------------------------------------------
        onLabelToggle(oEvent) {
            // Switch state: true=ON(레이블 표시) / false=OFF(레이블 숨김)
            const bState = oEvent.getParameter("state");
            this.getView().getModel("chartModel")
                .setProperty("/showLabel", bState);
            // 차트 재구성으로 레이블 상태 반영
            this._updateChart();
        },

        // -------------------------------------------------------
        // 차트 업데이트 핵심 함수
        // destroyFeeds() + destroyDataset() 후 완전 재구성
        // → 동적 체크박스 변경이 확실하게 반영됨
        // -------------------------------------------------------
        _updateChart() {
            const oChartModel = this.getView().getModel("chartModel");
            const aAllItems = oChartModel.getProperty("/items");
            const oVis = oChartModel.getProperty("/visibility");
            const bShowLabel = oChartModel.getProperty("/showLabel");
            const oViz = this.getView().byId("vizChart");
            const oVboxNoChart = this.getView().byId("vboxNoChart");

            if (!oViz || !aAllItems || aAllItems.length === 0) return;

            // Bar 계열 정의 (왼쪽 Y축: valueAxis)
            const aBarDef = [
                { key: "FcstQty", name: "예측수요량" },
                { key: "OrderQty", name: "주문량" },
                { key: "MpsQty", name: "MPS수량" },
                { key: "MpsRelQty", name: "MPS개시량" },
                { key: "SafetyStockQty", name: "안전재고량" }
            ];

            // Line 계열 정의 (단일 Y축: valueAxis — combination/line 공통)
            const aLineDef = [
                { key: "ProjectedAvailQty", name: "예상재고량" },
                { key: "AtpQty", name: "ATP수량" },
                { key: "BaseQty", name: "기준수요량" }
            ];

            const aBarChecked = aBarDef.filter(s => oVis[s.key]);
            const aLineChecked = aLineDef.filter(s => oVis[s.key]);
            const aBarNames = aBarChecked.map(s => s.name);
            const aLineNames = aLineChecked.map(s => s.name);

            const bHasBar = aBarNames.length > 0;
            const bHasLine = aLineNames.length > 0;

            // -------------------------------------------------------
            // 전체 해제 케이스: VizFrame 숨김 + 안내 메시지 표시
            // -------------------------------------------------------
            if (!bHasBar && !bHasLine) {
                oViz.setVisible(false);
                oVboxNoChart.setVisible(true);
                return;
            }

            // 차트 표시 상태 복원
            oViz.setVisible(true);
            oVboxNoChart.setVisible(false);

            // -------------------------------------------------------
            // Bar+Line 모두 있음 → combination (Y축 1개로 통일, Bar/Line 혼합)
            // Bar만 있음         → column      (Y축 1개, 막대만)
            // Line만 있음        → line        (Y축 1개, 꺾은선만)
            // → 모든 케이스에서 단일 Y축 사용으로 동일 기준 비교 가능
            // -------------------------------------------------------
            let sVizType;
            if (bHasBar && bHasLine) {
                sVizType = "combination";
            } else if (bHasBar) {
                sVizType = "column";
            } else {
                sVizType = "line";
            }

            // -------------------------------------------------------
            // Step 1: 기존 vizType 변경 + Feeds + Dataset 완전 제거
            // ⚠️ setVizType은 destroyFeeds/destroyDataset 전에 호출
            // → vizType 먼저 변경 후 기존 feed/dataset 제거해야 충돌 방지
            // -------------------------------------------------------
            oViz.setVizType(sVizType);
            oViz.destroyFeeds();
            oViz.destroyDataset();

            // -------------------------------------------------------
            // Step 2: FeedItem 먼저 구성 (Dataset보다 반드시 먼저!)
            // ⚠️ setDataset() 호출 시점에 VizFrame이 렌더링을 시도하는데
            //    이 때 valueAxis FeedItem이 없으면 [50005] 에러 발생
            // → addFeed() 완료 후 setDataset() 호출해야 함
            // -------------------------------------------------------
            // X축: 주차 레이블 (W01, W02 ...) — 모든 vizType 공통
            oViz.addFeed(new sap.viz.ui5.controls.common.feeds.FeedItem({
                uid: "categoryAxis", type: "Dimension", values: ["주차"]
            }));

            if (sVizType === "combination") {
                // Bar + Line 모두 단일 valueAxis에 통합
                // → 단일 Y축으로 동일 기준 비교 가능
                // → aBarNames + aLineNames 합쳐서 하나의 FeedItem으로 전달
                oViz.addFeed(new sap.viz.ui5.controls.common.feeds.FeedItem({
                    uid: "valueAxis",
                    type: "Measure",
                    values: [...aBarNames, ...aLineNames]
                }));
            } else if (sVizType === "column") {
                // Bar만 체크된 경우: 막대 차트 단독
                // → Bar 계열 이름 배열을 valueAxis에 전달
                oViz.addFeed(new sap.viz.ui5.controls.common.feeds.FeedItem({
                    uid: "valueAxis", type: "Measure", values: aBarNames
                }));
            } else {
                // Line만 체크된 경우: 꺾은선 차트 단독
                // → Line 계열 이름 배열을 valueAxis에 전달
                oViz.addFeed(new sap.viz.ui5.controls.common.feeds.FeedItem({
                    uid: "valueAxis", type: "Measure", values: aLineNames
                }));
            }

            // -------------------------------------------------------
            // Step 3: Dataset 구성 (FeedItem 등록 후 호출)
            // ⚠️ 반드시 addFeed() 완료 후 setDataset() 호출해야 함
            // → FeedItem이 먼저 등록된 상태에서 dataset이 들어와야
            //    렌더링 시 valueAxis를 정상적으로 찾을 수 있음
            // -------------------------------------------------------
            const aMeasures = [];

            // Bar 계열 measure 추가 (체크된 항목만)
            aBarChecked.forEach(s => {
                aMeasures.push(new sap.viz.ui5.data.MeasureDefinition({
                    name: s.name, value: `{${s.key}}`
                }));
            });

            // Line 계열 measure 추가 (체크된 항목만)
            aLineChecked.forEach(s => {
                aMeasures.push(new sap.viz.ui5.data.MeasureDefinition({
                    name: s.name, value: `{${s.key}}`
                }));
            });

            // Dataset 세팅: 주차(X축) + 체크된 measures
            oViz.setDataset(new sap.viz.ui5.data.FlattenedDataset({
                dimensions: [
                    new sap.viz.ui5.data.DimensionDefinition({
                        name: "주차", value: "{WeekLabel}"
                    })
                ],
                measures: aMeasures,
                data: { path: "chartModel>/items" }
            }));

            // -------------------------------------------------------
            // Step 4: vizProperties 설정
            // oColorMap → rules 동적 생성으로 리팩토링
            // -------------------------------------------------------

            // 색상 맵: 색상 변경 시 여기만 수정하면 됨
            const oColorMap = {
                "예측수요량": { color: "#5B9BD5" },
                "주문량": { color: "#1F4E79" },
                "MPS수량": { color: "#70AD47" },
                "MPS개시량": { color: "#FF0000" },
                "안전재고량": { color: "#A5A5A5" },
                "예상재고량": { color: "#833C00", lineColor: "#833C00" },
                "ATP수량": { color: "#C9956C", lineColor: "#C9956C" },
                "기준수요량": { color: "#7030A0", lineColor: "#7030A0" }
            };

            // oColorMap → rules 동적 생성
            const aRules = Object.entries(oColorMap).map(([name, props]) => ({
                dataContext: { [name]: "*" },
                properties: props,
                displayName: name
            }));

            // combination에서 Bar/Line 모양 지정:
            // valueAxis에 Bar+Line 순서로 모두 넣었으므로
            // primaryAxis 배열도 Bar는 "bar", Line은 "line"으로 순서대로 지정
            // → ["bar","bar","bar","bar","bar","line","line","line"] 형태
            const aPrimaryShape = [
                ...aBarNames.map(() => "bar"),
                ...aLineNames.map(() => "line")
            ];

            oViz.setVizProperties({
                title: { visible: false },
                plotArea: {
                    // combination: primaryAxis에 Bar/Line 모양 혼합 지정
                    // column/line: 단일 타입이라 설정해도 무시됨
                    dataShape: {
                        // Bar는 "bar", Line은 "line"으로 순서대로 지정
                        primaryAxis: aPrimaryShape.length > 0 ? aPrimaryShape : ["bar"]
                        // secondaryAxis 제거: combination은 단일 Y축이라 불필요
                    },
                    dataPointStyleMode: "override",
                    dataPointStyle: { rules: aRules },
                    dataLabel: {
                        // Switch ON/OFF 상태에 따라 레이블 표시/숨김
                        visible: bShowLabel,
                        position: "outside",
                        formatString: "0",
                        style: {
                            color: "#000000",
                            fontSize: 11
                        },
                        hideWhenOverlap: true
                    }
                },
                // 단일 Y축: "수량" 제목 표시
                // column/line/combination 모두 동일하게 적용
                valueAxis: {
                    title: { visible: true, text: "수량" }
                },
                // valueAxis2 완전 제거: combination은 단일 Y축이라 불필요
                categoryAxis: { title: { visible: false } },
                interaction: {
                    selectability: { mode: "NONE" }
                }
            });

        },

        // -------------------------------------------------------
        // 탭 전환 이벤트
        // 차트 탭 선택 시 VizFrame 크기 재계산 (렌더링 보정)
        // -------------------------------------------------------
        onTabSelect(oEvent) {
            const sKey = oEvent.getParameter("selectedKey");
            if (sKey === "tabChart") {
                // 탭 전환 시 현재 체크박스 상태 기준으로 차트 재구성
                setTimeout(() => this._updateChart(), 100);
            }
        },

        // -------------------------------------------------------
        // 뒤로가기: 브라우저 히스토리 있으면 go(-1), 없으면 Main으로
        // -------------------------------------------------------
        onNavBack() {
            const oHistory = History.getInstance();
            const sPreviousHash = oHistory.getPreviousHash();

            if (sPreviousHash !== undefined) {
                window.history.go(-1);
            } else {
                this.getOwnerComponent().getRouter()
                    .navTo("RouteMain", {}, true);
            }
        }
    });
});