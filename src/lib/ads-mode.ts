// 광고 데이터 저장 위치 스위치
//   false: (나란히 비교 기간) 광고주 등록·피이관·API는 예전 대시보드에 저장 → 통합 DB로 바로 맞춤
//   true : (전환 후) 통합 DB에 바로 저장. 예전 대시보드는 더 이상 쓰지 않음
export const ADS_WRITES_LOCAL = false;
