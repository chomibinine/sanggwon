export default async function handler(req, res) {
  const { lat, lng, lcls, mcls, budget, lawdCd } = req.query;
  const API_KEY = process.env.PUBLIC_API_KEY;

  try {
    // 1. 소상공인 상가 데이터 호출 (실제 업종 밀집도 파악)
    const bizUrl = `https://apis.data.go.kr/B553077/api/open/sdsc2/storeListInRadius?serviceKey=${API_KEY}&radius=500&cx=${lng}&cy=${lat}&type=json&indsLclsCd=${lcls || ''}&indsMclsCd=${mcls || ''}&numOfRows=100`;
    
    // 2. 국토교통부 실거래가 호출 (최근 2개월)
    const date = new Date();
    date.setMonth(date.getMonth() - 2);
    const dealYmd = date.getFullYear() + String(date.getMonth() + 1).padStart(2, '0');
    const molitUrl = `https://apis.data.go.kr/1613000/RTMSDataSvcNrgTrade/getRTMSDataSvcNrgTrade?serviceKey=${API_KEY}&LAWD_CD=${lawdCd}&DEAL_YMD=${dealYmd}&numOfRows=50`;

    // 병렬로 진짜 데이터만 긁어옵니다.
    const [bizRes, molitRes] = await Promise.all([
      fetch(bizUrl).catch(() => null),
      fetch(molitUrl).catch(() => null)
    ]);

    // --- 상가 수 파싱 ---
    let bizCount = 0;
    if (bizRes && bizRes.ok) {
      const bizJson = await bizRes.json();
      bizCount = bizJson.body && bizJson.body.items ? bizJson.body.items.length : 0;
    }

    // --- 국토부 실거래가 XML 파싱 (Node.js 환경에 맞춘 정규식 추출) ---
    let realEstatePyeongPrice = 0;
    let isRealData = false;

    if (molitRes && molitRes.ok) {
      const xmlText = await molitRes.text();
      
      const prices = [...xmlText.matchAll(/<거래금액>(.*?)<\/거래금액>/g)].map(m => parseInt(m[1].trim().replace(/,/g, '')));
      const areas = [...xmlText.matchAll(/<건물면적>(.*?)<\/건물면적>/g)].map(m => parseFloat(m[1].trim()));

      if (prices.length > 0 && areas.length > 0) {
        let totalPrice = 0, totalArea = 0;
        const len = Math.min(prices.length, areas.length);
        for(let i=0; i < len; i++) {
          totalPrice += prices[i];
          totalArea += areas[i];
        }
        if (totalArea > 0) {
          // 총 거래금액(만 원) / 총 건물면적(㎡) * 3.3058 = 평당 매매가(만 원)
          realEstatePyeongPrice = Math.round((totalPrice / totalArea) * 3.3058);
          isRealData = true;
        }
      }
    }

    // 데이터가 아예 없는 구역일 경우의 엄격한 예외 처리
    if (!isRealData) {
      // 거짓 데이터를 만들지 않고, 0으로 처리하여 프론트에 "데이터 없음"을 명시하도록 유도
      realEstatePyeongPrice = 0; 
    }

    // 3. 진짜 데이터를 기반으로 한 분석 계산
    const pyeong = 15; // 15평 기준
    let monthlyRent = 0;
    let targetSales = 0;
    let customersNeededPerDay = 0;
    let unitPrice = (lcls === 'I' && mcls === 'I12') ? 4500 : 12000;

    if (isRealData) {
      // 상가 수익률 5% 가정: (평당매매가 * 15평 * 5%) / 12개월
      monthlyRent = Math.round(((realEstatePyeongPrice * pyeong) * 0.05) / 12);
      targetSales = monthlyRent * 10; // 생존 한계선: 월세의 10배
      customersNeededPerDay = Math.ceil((targetSales * 10000) / unitPrice / 30);
    }

    // 4. 입지 매력도 점수 산출
    let score = 100;
    if (bizCount > 30) score -= 30;
    else if (bizCount > 10) score -= 15;
    if (monthlyRent > 400) score -= 20;
    else if (monthlyRent > 200) score -= 10;
    if (bizCount <= 5 && monthlyRent > 0 && monthlyRent < 150) score += 15; // 꿀상권 가점
    
    const finalScore = isRealData ? Math.max(30, Math.min(score, 98)) : 0;

    // 5. 철저히 팩트에 기반한 액션 아이템
    let summary = "";
    let actionItems = [];

    if (!isRealData) {
      summary = "최근 2개월 내 상업용 실거래 데이터가 없는 지역입니다.";
      actionItems.push("⚠️ 공공데이터 실거래 내역이 부족하여 정확한 임대료 추산이 불가합니다.");
      actionItems.push("💡 주변 부동산을 직접 방문하여 바닥 권리금과 실제 월세 시세를 현장 점검해야 합니다.");
    } else {
      if (bizCount > 20) {
        summary = `반경 내 동일 업종이 ${bizCount}개나 포진한 초경쟁 구역입니다.`;
        actionItems.push(`🔥 기존 ${bizCount}개 매장과 파이를 나눠 먹어야 합니다. 명확한 컨셉 차별화가 필수입니다.`);
      } else {
        summary = `경쟁 강도가 비교적 양호한 구역입니다. 배후 수요를 점검하세요.`;
        actionItems.push(`💡 주변에 대단지 아파트나 오피스 상주 인구가 충분한지 로컬 데이터를 확인하세요.`);
      }

      if (monthlyRent > 0) {
        actionItems.push(`💰 국토부 실거래가 환산 기준, 매월 최소 <b>${targetSales.toLocaleString()}만 원</b>의 매출을 올려야 적자를 면합니다.`);
        actionItems.push(`👥 객단가 ${unitPrice.toLocaleString()}원 기준, 하루 평균 <b>${customersNeededPerDay}명</b>의 결제가 필요합니다.`);
      }

      const totalEstimatedCost = (monthlyRent * 12) + (pyeong * 200); // 보증금 + 인테리어
      if (parseInt(budget) < totalEstimatedCost) {
        actionItems.push(`🚨 입력하신 자본금(${parseInt(budget).toLocaleString()}만 원)으로는 이 지역의 평균 초기 비용(약 ${totalEstimatedCost.toLocaleString()}만 원)을 감당하기 위험합니다.`);
      }
    }

    res.status(200).json({
      success: true,
      data: {
        isRealData,
        bizCount,
        realEstatePyeongPrice,
        monthlyRent,
        targetSales,
        customersNeededPerDay,
        unitPrice,
        score: finalScore,
        analysis: { summary, actionItems }
      }
    });

  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}
