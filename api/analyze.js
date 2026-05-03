export default async function handler(req, res) {
  // 프론트에서 넘겨받은 파라미터 (좌표, 업종 대분류/중분류, 예산 등)
  const { lat, lng, lcls, mcls, budget } = req.query;
  const API_KEY = process.env.PUBLIC_API_KEY;

  try {
    // 1. 소상공인 API 호출 (상가 수 파악)
    const bizUrl = `https://apis.data.go.kr/B553077/api/open/sdsc2/storeListInRadius?serviceKey=${API_KEY}&radius=500&cx=${lng}&cy=${lat}&type=json&indsLclsCd=${lcls || ''}&indsMclsCd=${mcls || ''}`;
    const bizRes = await fetch(bizUrl);
    const bizJson = await bizRes.json();
    const bizCount = bizJson.body ? bizJson.body.items.length : 0;

    // 2. 임대료 추정 (국토부 연동 전 임시 난수. 평당 10~25만 원)
    const rentPerPyeong = 10 + Math.floor(Math.random() * 15); 
    const assumePyeong = 15; // 15평 기준
    const monthlyRent = rentPerPyeong * assumePyeong; // 월세 추정치 (단위: 만원)

    // 3. 생존 마지노선(BEP) 계산 (월세는 매출의 10%를 넘으면 안 된다는 불문율 적용)
    const targetSales = monthlyRent * 10; 
    
    // 객단가 가정 (카페: 4,500원 / 식당: 12,000원 등)
    const unitPrice = (lcls === 'I' && mcls === 'I12') ? 4500 : 12000;
    const customersNeededPerMonth = Math.ceil((targetSales * 10000) / unitPrice);
    const customersNeededPerDay = Math.ceil(customersNeededPerMonth / 30);

    // 4. 입지 매력도 점수 (Score)
    let score = 100 - Math.min(bizCount * 1.5, 40) - (rentPerPyeong > 20 ? 20 : 5);
    const finalScore = Math.max(30, Math.min(Math.round(score), 98));

    // 5. 맞춤형 액션 아이템 생성 (팩트 폭격)
    let summary = "";
    let actionItems = [];

    if (bizCount > 30) {
      summary = "경쟁이 극도로 치열한 '레드오션'입니다. 차별화 없이는 진입 불가합니다.";
      actionItems.push("🔥 주변 동일 업종의 간판 없는 숨은 강자(맛집)를 반드시 사전 조사하세요.");
      actionItems.push("📉 고정비를 낮추기 위해 1층 메인 스트리트보다는 1.5층이나 이면도로 매물을 찾으세요.");
    } else if (bizCount > 10) {
      summary = "수요와 공급이 팽팽한 '격전지'입니다. 안정적이지만 리스크 관리도 필요합니다.";
      actionItems.push("⚖️ 권리금이 너무 높게 형성되어 있다면 과감히 포기하세요.");
      actionItems.push("📱 홀 매출에만 의존하지 말고, 배달/포장 패키지를 반드시 기획하세요.");
    } else {
      summary = "경쟁점이 적은 '블루오션' 가능성이 있습니다. 배후 수요만 확실하다면 선점하세요.";
      actionItems.push("🕵️‍♂️ 왜 이곳에 동종 업계가 없는지 '함정(배후 세대 부족 등)'을 먼저 의심해 보세요.");
      actionItems.push("📣 초기 오픈 시 지역 커뮤니티(당근마켓 등)를 통한 적극적인 로컬 마케팅이 필수입니다.");
    }

    if (parseInt(budget) < (monthlyRent * 12 + 5000)) { // 보증금(월세 1년치) + 인테리어 최소 5천
      actionItems.push("⚠️ 입력하신 예산으로는 이 지역의 보증금과 시설비를 감당하기 빠듯합니다. 대출 등 추가 자금 계획이 필요합니다.");
    }

    // 6. 풍부해진 JSON 응답
    res.status(200).json({
      success: true,
      data: {
        bizCount,
        monthlyRent,
        targetSales,
        customersNeededPerDay,
        unitPrice,
        score: finalScore,
        analysis: { summary, actionItems }
      }
    });

  } catch (e) {
    res.status(500).json({ success: false, error: "데이터 수집 실패" });
  }
}
