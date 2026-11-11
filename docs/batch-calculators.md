# 배치 계산기 대조

기준은 `daon-settlement-batch`의 로컬 `develop-feature/DAONSTMT-801`, 커밋 `1d34afaf335f3b646741077b4c3b20896374e8fe`다. 2026-11-11에 계산기·호출 서비스·매퍼·테스트를 읽었다. 배치의 미커밋 작업은 수정하지 않았다. 이 기록은 운영 배포 버전이나 운영 DB와의 일치를 뜻하지 않는다.

## 반영한 계산

| generator 위치                                                                                  | 배치 근거                                                                                              | 반영                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `public/calculation/rounding-unit.js`, `analyzer.js`, `rounding-policy.js`, `product-insert.js` | `src/main/java/kr/co/danal/core/calculator/common/code/RoundingRule.java:34`                           | 단위값은 금액이 아니라 `BigDecimal.setScale`의 정수 자릿수다. `0`은 1원, `-1`은 10원, `2`는 0.01원이다. 분석·편집·미리보기·계산·복사·INSERT를 통일했다. 명시적 NULL 단위는 계산 시 배치처럼 scale 0으로 사용한다. 이전 이력은 자동 변환하지 않고 이전 해석으로 저장됐음을 표시한다. |
| `public/calculation/verify.js`                                                                  | `core/calculator/merchant/fee/operation/CalculateMerchantFeeExecutor.java`                             | BASE는 0 대상이면 0, 제공량 이하면 기본요금, 초과하면 기본요금 + 초과량 × 단가다. SLIDING은 선택 구간 `[시작, 끝)`의 단가를 전체 대상에 적용한다. 누진 합산하지 않는다. 계약값을 입력해야 계산한다.                                                                                 |
| `public/calculation/verify.js`                                                                  | `MerchantFeePipelineBuilder.java`, `MerchantMinimumFeeExecutor.java`                                   | 최소 수수료는 단수 처리 뒤 적용하며 원거래가 음수면 최소값도 음수다. 최소 금액을 입력해야 계산한다.                                                                                                                                                                                 |
| `public/calculation/custom-calculation.js`                                                      | `business/common/calculator/merchant/custom/sum/mobile/MobileRateIncludeVatMerchantSumCalculator.java` | `MOBILE-RATE-INCL`: 전달받은 VAT 포함 수수료 합계 ÷ 1.1 → 소수 6자리 HALF_UP → 정수 FLOOR. VAT는 원래 합계와의 차액이다.                                                                                                                                                            |
| 같은 파일                                                                                       | `MobileTmonetMerchantSumCalculator.java`                                                               | `MOBILE-TIMONET`: 합계 절댓값 ÷ 1.1 → 소수 6자리 HALF_UP → 정수 FLOOR → 합계의 원래 부호. 음수에서 일반 VAT 포함 계산과 결과가 다르다.                                                                                                                                              |
| 같은 파일                                                                                       | `MobileGovernmentOfficeMerchantSumCalculator.java`                                                     | `MOBILE-GOVERNMENT`: 거래금액 합계 − 지급예정금액 합계를 나눠 수수료와 VAT를 역산한다. 요율은 사용하지 않는다.                                                                                                                                                                      |
| 같은 파일, `public/calculation/batch-reference.js`                                              | `SelfConfirmCustomMerchantSumCalculatorConfig.java`, `SelfConfirmIncludeVatMerchantSumCalculator.java` | `SELF-STANDARD-SCNT-INCL`, `SELF-STANDARD-TCNT-INCL`: 건수 × 단가와 VAT를 선계산하고 총액을 10원 단위로 절사한 뒤 재분리한다. DB 스냅샷은 COMMON이라 자동 전환하지 않는다. 사용자가 계산기에서 CUSTOM을 명시적으로 선택해 테스트한다. 저장 상품과 INSERT에는 반영하지 않는다.       |

CUSTOM은 합산 검증에서 실행한다. 수수료 합계·지급예정금액은 **계산 입력**으로 따로 받으며 AS-IS 비교 금액을 대신 사용하지 않는다. 구현이 확인되지 않은 `MOBILE-COUPANG`, `MOBILE-EACH-VAT-SUM`, `MOBILE-FIXED-INCL`은 공통식으로 대신 계산하지 않는다. `public/product-examples.js`의 DB 스냅샷과 레거시 SQL 확인 상태도 그대로 유지한다.

## 아직 같은 것으로 취급할 수 없는 부분

- `MerchantCalculateCommandMapper.toSignPositionEnum`은 BEFORE·AFTER만 처리한다. Dataware와 상품 스냅샷의 NONE을 받지 못한다. generator는 NONE 설정을 유지하고 배치와의 차이를 화면에 표시한다.
- `MerchantVatPipelineBuilder`는 BEFORE일 때 ROUND → APPLY_SIGN, AFTER일 때 APPLY_SIGN → ROUND 순서다. 수수료 파이프라인과 반대다. NULL 위치일 때는 VAT의 ROUND가 실행되지 않는다. generator의 일반 계산은 상품 설정을 대입한 결과이며 배치 실행 결과와 같다고 표시하지 않는다. 음수·NULL 위치의 VAT는 화면에서도 확인 필요로 알린다.
- 공통 INCLUDED는 `IncludeVatMerchantFeeRecalculateExecutor`가 수수료 × 10 ÷ 11을 정수 HALF_UP으로 재계산한다. `CalculateMerchantVatExecutor`의 고정 수수료 포함 VAT는 단가 − 계산된 수수료이며 건수를 다시 곱하지 않는다. 이것을 본인확인의 CUSTOM 재분리와 같은 식으로 일반화하지 않는다. COMMON INCLUDED는 계산을 보류하고 엔진 매핑 확인을 안내한다.
- 취소 수수료 정책의 NOT_REFUND·CA_ONLY_REFUND, 부가서비스 수수료, 환율은 이번 일반 계산 확장에 포함하지 않는다. 원거래 유형·부가수수료·환율 입력이 없는 결과를 완전한 배치 검증으로 해석하면 안 된다.
- BASE의 금액 기준 초과분은 배치 자체에 재확인 TODO가 있다. generator는 확인한 구현의 식을 제공하며 계약 정책이 확정됐다고 표시하지 않는다.

## Dataware 대조

`explore_dataware`에 `project=settlement-formula-studio`, `target=table`, `keywords=[TB_SSI_MERC_SMT_GDS_M]`를 전달했다. 모델은 **DAON플랫폼개발 / DaOn_차세대 / 정산 / SSI_가맹점정산상품**이며 응답 기준 시각은 **2026-11-11 16:00**이다.

| 코드 위치 / 대상                                                                                                     | 코드 정의                           | 모델 정의                                                        | 판정 / 차이                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `public/calculation/rounding-unit.js`, `public/product-insert.js` / `FEE_SMT_CALC_UNIT_VAL`, `VAT_SMT_CALC_UNIT_VAL` | 정수 scale, 저장 범위 -999~999      | NUMERIC(3), nullable. 1자리 0, 10자리 -1, 소수 n자리 n           | 일치: 조회한 타입·NULL 허용·단위 의미. 브라우저 실제 연산은 소수 자릿수 ±38 범위이며 범위 밖을 조용히 계산하지 않는다.        |
| `public/domain.js`, `rounding-policy.js` / `FEE_SMT_CALC_MHOD_DVCD`, `VAT_SMT_CALC_MHOD_DVCD`                        | 배치와 스냅샷은 CEILING             | 정산계산방식구분코드의 올림 값은 CELING                          | 불일치: 철자가 다르다. 모델만 보고 계산기·저장값을 바꾸지 않았다.                                                             |
| `public/domain.js` / `VAT_DVCD`                                                                                      | 배치와 스냅샷은 SEPARATED           | 부가가치세구분코드의 별도 값은 SPERATED                          | 불일치: 철자가 다르다. 기존 배치·스냅샷 값을 유지했다.                                                                        |
| `public/domain.js` / `SIGN_APLY_LOCT_DVCD`                                                                           | BEFORE, AFTER, NONE                 | 동일 3개 값, NONE은 2026-11-05부터 등록                          | 코드 목록 일치. 배치 매퍼의 NONE 미지원은 별도 구현 차이다.                                                                   |
| `public/calculation/product-context.js`, `verify.js` / `TRFS_DVCD`                                                   | STANDARD, BASE, SLIDING             | 동일 3개 값                                                      | 코드 목록 일치. 실제 기본요금·제공량·구간은 상품 테이블에 없으므로 사용자가 입력한다.                                         |
| `public/calculation/batch-reference.js` / `CALC_ENGE_DVCD`                                                           | 배치 분기와 스냅샷의 COMMON, CUSTOM | 테이블 컬럼은 VARCHAR(20), nullable. 코드 도메인은 확인하지 못함 | 미등록/확인 필요: code 완전 일치 `CALC_ENGE_DVCD`, 패턴 `%계산%엔진%` 모두 0건. 이 조회 응답은 **2026-11-11 17:00** 기준이다. |

코드 목록은 `target=code`, `keywords=[정산계산방식구분코드, 부가가치세구분코드, 부호적용위치구분코드, 요금제구분코드, 취소수수료정책구분코드]`로 조회했다. 이 응답은 2026-11-11 16:00 기준이다. 실제 운영 DDL·데이터와 일치한다고 단정하지 않는다.

## 재현과 검증

`node scripts/export-batch-reference.js ../daon-settlement-batch`는 지정한 저장소 HEAD의 실제 Java 소스에서 CUSTOM 산술 메서드와 RoundingRule을 읽어 JVM에서 실행한다. 배치 체크아웃은 수정하지 않는다. 추출한 산술 부분만 검증하며 Spring 라우팅·정책 조회·DB 접속을 실행하는 통합 테스트가 아니다.

생성한 `test/fixtures/batch-calculator-jvm.json`에는 커밋, 소스 SHA-256, 양수·음수·0·소수 6자리 경계·본인확인 총액 재분리 22개 사례와 scale 6개 사례를 남겼다. `test/batch-calculator.test.js`에서 이 기준값과 generator 결과를 비교한다. 추가로 학교 상품 3개, 기본요금 0·경계·초과, 구간 끝값 제외, 최소 수수료, 필수 입력 누락, 미지원 CUSTOM, 기존 이력 보존을 검증한다.
