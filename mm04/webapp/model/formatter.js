sap.ui.define([], function () {
    "use strict";

    return {

        // MPS 헤더 실행상태 텍스트 변환
        // ZDD4_MM_MPH_STATUS: EC=실행완료, EF=실행실패, CN=실행취소
        statusText: function (sStatus) {
            var oMap = {
                "EC": "실행완료",
                "EF": "실행실패",
                "CN": "실행취소"
            };
            return oMap[sStatus] || sStatus;
        },


        // MPS 헤더 실행상태 → ObjectStatus state 변환
        // sap.ui.core.ValueState: Success/Error/Warning/None
        statusState: function (sStatus) {
            var oMap = {
                "EC": "Information",  // 파란색 (실행완료)
                "EF": "Error",        // 빨간색 (실행실패)
                "CN": "None"          // 회색   (실행취소)
            };
            return oMap[sStatus] || "None";
        },


        // MPS 헤더 실행상태 → LED 색상 변환 (sap.m.ObjectStatus icon용)
        statusIcon: function (sStatus) {
            var oMap = {
                "EC": "sap-icon://circle-task-2",  // 파랑
                "EF": "sap-icon://error",           // 빨강
                "CN": "sap-icon://sys-minus"        // 회색
            };
            return oMap[sStatus] || "sap-icon://sys-minus";
        },


        // MPS 아이템 상태 텍스트 변환
        // ZDD4_MM_MPI_STATUS: WA=승인대기, AP=승인완료, CN=계획취소, RJ=반려
        itemStatusText: function (sStatus) {
            var oMap = {
                "WA": "승인대기",
                "AP": "승인완료",
                "CN": "계획취소",
                "RJ": "반려"
            };
            return oMap[sStatus] || sStatus;
        },


        // MPS 아이템 상태 → ObjectStatus state 변환
        // 초록=확정포함(AP), 노랑=승인대기(WA), 빨강=계획취소(CN)/반려(RJ)
        itemStatusState: function (sStatus) {
            var oMap = {
                "AP": "Success",   // 초록 (확정포함/승인완료)
                "WA": "Warning",   // 노랑 (승인대기)
                "CN": "Error",     // 빨강 (계획취소)
                "RJ": "Error"      // 빨강 (반려)
            };
            return oMap[sStatus] || "None";
        },


        // 안전재고유형 텍스트 변환
        // ZDD4_MM_SS_TYPE: A=자동계산, M=수동입력
        ssTypeText: function (sSsType) {
            var oMap = {
                "A": "자동계산",
                "M": "수동입력"
            };
            return oMap[sSsType] || sSsType;
        },


        // 확정여부 텍스트 변환
        // ZDD4_MM_FIXED_YN: X=확정, (공백)=미확정
        fixedYnText: function (sFixedYn) {
            return sFixedYn === "X" ? "확정" : "미확정";
        },


        // Edm.DateTime → YYYY.MM.DD 형태 날짜 포맷
        // OData DateTime: /Date(1234567890000)/ 형태
        formatDate: function (oDate) {
            if (!oDate) {
                return "";
            }
            var oDateFormat = sap.ui.core.format.DateFormat.getDateInstance({
                pattern: "yyyy.MM.dd"
            });
            return oDateFormat.format(oDate);
        },


        // Edm.Time → HH:MM:SS 형태 시간 포맷
        formatTime: function (oTime) {
            if (!oTime) {
                return "";
            }
            var oTimeFormat = sap.ui.core.format.DateFormat.getTimeInstance({
                pattern: "HH:mm:ss"
            });
            return oTimeFormat.format(oTime);
        },


        // 수량 포맷 (소수점 0자리 정수로 표시)
        formatQty: function (sQty) {
            if (!sQty) {
                return "0";
            }
            var oNumberFormat = sap.ui.core.format.NumberFormat.getFloatInstance({
                maxFractionDigits: 0,
                groupingEnabled: true
            });
            return oNumberFormat.format(parseFloat(sQty));
        }

    };
});