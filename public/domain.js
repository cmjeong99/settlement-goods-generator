export const FIELDS = [
  ['FRIM_BASE_DVCD', '과금 기준', ['AMOUNT', 'SCOUNT', 'TCOUNT']],
  ['FEE_TYPE_DVCD', '수수료 타입', ['RATE', 'FIXED']],
  ['FEE_SMT_CALC_BASE_DVCD', '수수료 기준', ['EACH', 'SUM']],
  [
    'FEE_SMT_CALC_MHOD_DVCD',
    '수수료 방식',
    ['NONE', 'DOWN', 'HALF_UP', 'CEILING', 'HALF_DOWN', 'SIGNED_DOWN'],
  ],
  ['FEE_SMT_CALC_UNIT_VAL', '수수료 단위', null],
  ['VAT_DVCD', 'VAT 구분', ['INCLUDED', 'SEPARATED', 'ZERO']],
  ['VAT_CALC_TRGT_DVCD', 'VAT 대상', ['FEE', 'AMOUNT', 'NONE']],
  ['VAT_SMT_CALC_BASE_DVCD', 'VAT 기준', ['EACH', 'SUM']],
  [
    'VAT_SMT_CALC_MHOD_DVCD',
    'VAT 방식',
    ['NONE', 'DOWN', 'HALF_UP', 'CEILING', 'HALF_DOWN', 'SIGNED_DOWN'],
  ],
  ['VAT_SMT_CALC_UNIT_VAL', 'VAT 단위', null],
  ['ABS_PROCS_YN', '절대값 처리', ['Y', 'N']],
  ['SIGN_APLY_LOCT_DVCD', '부호 적용 위치', ['BEFORE', 'AFTER', 'NONE']],
];
export const display = (cell) =>
  cell?.value ??
  (cell?.status === 'custom'
    ? '별도 계산 필요'
    : cell?.status === 'not-applicable'
      ? '미적용'
      : '미확정');
export function describeField(key, cell) {
  if (cell?.value === null || cell?.value === undefined)
    return cell?.status === 'custom'
      ? '따로 계산해야 해요'
      : cell?.status === 'not-applicable'
        ? '사용하지 않아요'
        : '수식만으로 알 수 없어요';
  if (key.endsWith('_UNIT_VAL')) return `${cell.value === 0 ? 1 : cell.value}원 단위`;
  if (key === 'ABS_PROCS_YN')
    return cell.value === 'Y' ? '절대값으로 계산' : '절대값으로 바꾸지 않음';
  if (key === 'SIGN_APLY_LOCT_DVCD')
    return (
      {
        BEFORE: '반올림·절사 전 부호 적용',
        AFTER: '반올림·절사 후 부호 적용',
        NONE: '부호를 다시 적용하지 않음',
      }[cell.value] ?? String(cell.value)
    );
  const names = {
    AMOUNT: key === 'VAT_CALC_TRGT_DVCD' ? '반올림 전 금액 × 요율' : '거래 금액',
    SCOUNT: '성공 건수',
    TCOUNT: '시도 건수',
    RATE: '정률',
    FIXED: '정액',
    EACH: '건별 계산',
    SUM: '합산 후 계산',
    NONE: '계산하지 않음',
    DOWN: '절사',
    HALF_UP: '반올림',
    CEILING: '올림',
    HALF_DOWN: '절반이면 버림',
    SIGNED_DOWN: '음수도 작은 쪽으로 내림',
    INCLUDED: '부가세 포함',
    SEPARATED: '부가세 별도',
    ZERO: '부가세 0원',
    FEE: '계산된 수수료',
  };
  return names[cell.value] ?? String(cell.value);
}
export function explainCalculation(result) {
  const fields = result.fields;
  const value = (key) => (fields[key]?.status === 'known' ? fields[key].value : null);
  const rounding = (subject, prefix) => {
    const key = `${prefix}_SMT_CALC_MHOD_DVCD`,
      method = value(key);
    if (fields[key]?.status === 'custom') return `${subject}의 단수 처리는 별도 계산이 필요해요.`;
    if (method === null) return `${subject}의 반올림·절사 방식은 추가 확인이 필요해요.`;
    if (method === 'NONE') return `${subject}에 별도 반올림이나 절사는 적용하지 않아요.`;
    const unit = value(`${prefix}_SMT_CALC_UNIT_VAL`);
    const unitText = unit === null ? '' : `${unit === 0 ? 1 : unit}원 단위로 `;
    const actions = {
      DOWN: '절사해요',
      HALF_UP: '반올림해요',
      CEILING: '올림해요',
      HALF_DOWN: '정확히 절반이면 버리는 방식으로 반올림해요',
      SIGNED_DOWN: '음수도 더 작은 값이 되도록 내려요',
    };
    return `${subject}는 ${unitText}${actions[method] ?? '단수 처리를 해요'}.${unit === null ? ' 계산 단위는 추가 확인이 필요해요.' : ''}`;
  };
  const fee = [];
  const base = value('FRIM_BASE_DVCD'),
    type = value('FEE_TYPE_DVCD'),
    feeCycle = value('FEE_SMT_CALC_BASE_DVCD');
  if (type === 'RATE') {
    fee.push(
      feeCycle === 'SUM'
        ? '거래금액을 합산한 뒤 요율을 곱해 수수료를 계산해요.'
        : feeCycle === 'EACH'
          ? '거래마다 금액에 요율을 곱해 수수료를 계산해요.'
          : '금액에 요율을 곱해 수수료를 계산해요. 건별 계산인지 합산 후 계산인지는 추가 확인이 필요해요.',
    );
  } else if (type === 'FIXED') {
    fee.push(
      base === 'SCOUNT'
        ? '성공 건수에 정해진 단가를 곱해 수수료를 계산해요.'
        : base === 'TCOUNT'
          ? '시도 건수에 정해진 단가를 곱해 수수료를 계산해요.'
          : '수수료는 정해진 단가로 계산해요. 과금 기준이 성공 건수인지 시도 건수인지는 추가 확인이 필요해요.',
    );
    if (feeCycle === 'SUM') fee.push('건수를 합산한 뒤 단가를 적용해요.');
  } else fee.push('수수료가 정액인지 정률인지는 수식만으로 확정할 수 없어요.');
  fee.push(rounding('수수료', 'FEE'));
  if (
    feeCycle === 'EACH' &&
    result.formulas?.fee?.kind === 'call' &&
    result.formulas.fee.name === 'SUM'
  )
    fee.push('거래별로 계산한 수수료를 마지막에 합산해요.');

  const vat = [],
    vatType = value('VAT_DVCD'),
    vatTarget = value('VAT_CALC_TRGT_DVCD'),
    vatCycle = value('VAT_SMT_CALC_BASE_DVCD');
  if (vatType === 'ZERO') vat.push('부가세는 0원으로 처리해요.');
  else if (vatType === 'INCLUDED')
    vat.push(
      '부가세가 수수료에 포함된 설정이에요. 포함된 부가세를 분리하는 원문 계산식을 확인해 주세요.',
      rounding('부가세', 'VAT'),
    );
  else {
    if (vatTarget === 'FEE')
      vat.push(
        vatCycle === 'SUM'
          ? feeCycle === 'SUM'
            ? '합산 기준으로 계산된 수수료에 10%를 적용해 부가세를 계산해요.'
            : '거래별로 계산한 수수료를 합산한 금액에 10%를 적용해 부가세를 계산해요.'
          : '계산된 수수료에 10%를 적용해 부가세를 계산해요.',
      );
    else if (vatTarget === 'AMOUNT')
      vat.push(
        vatCycle === 'SUM'
          ? '거래금액을 합산한 뒤 요율과 10%를 곱해 부가세를 계산해요. 수수료의 단수 처리 결과는 사용하지 않아요.'
          : '수수료의 단수 처리를 하기 전 금액에 요율과 10%를 곱해 부가세를 계산해요.',
      );
    else
      vat.push(
        fields.VAT_CALC_TRGT_DVCD?.status === 'custom'
          ? '부가세는 조건식이나 차감식에 따라 별도로 계산해야 해요.'
          : '부가세를 어떤 금액으로 계산하는지는 추가 확인이 필요해요.',
      );
    vat.push(rounding('부가세', 'VAT'));
    if (
      vatCycle === 'EACH' &&
      result.formulas?.vat?.kind === 'call' &&
      result.formulas.vat.name === 'SUM'
    )
      vat.push('거래별로 계산한 부가세를 마지막에 합산해요.');
  }

  const sign = [],
    absolute = value('ABS_PROCS_YN'),
    position = value('SIGN_APLY_LOCT_DVCD');
  sign.push(
    absolute === 'Y'
      ? '금액은 절댓값으로 처리해요.'
      : absolute === 'N'
        ? '거래금액을 절댓값으로 바꾸지 않아요.'
        : '절댓값 처리 여부는 추가 확인이 필요해요.',
  );
  if (position === 'NONE')
    sign.push(
      '원래 거래금액의 부호는 다시 붙이지 않아요. 단수 처리는 위에서 설명한 방식대로 유지해요.',
    );
  else if (position === 'BEFORE') sign.push('원래 거래금액의 부호를 반올림·절사 전에 적용해요.');
  else if (position === 'AFTER') sign.push('원래 거래금액의 부호를 반올림·절사 후에 적용해요.');
  else sign.push('별도의 부호 처리 위치는 수식만으로 확정할 수 없어요.');
  return [fee.join(' '), vat.join(' '), sign.join(' ')];
}
export function exportRow(result, format = 'markdown', name = null) {
  const headers = [...(name ? ['SMT_GDS_CD', 'SMT_GDS_NM'] : []), ...FIELDS.map((f) => f[0])];
  const values = [
    ...(name ? [name.code, name.name] : []),
    ...FIELDS.map((f) => display(result.fields[f[0]])),
  ];
  if (format === 'tsv')
    return [headers, values]
      .map((r) => r.map((v) => String(v).replace(/[\t\r\n]/g, ' ')).join('\t'))
      .join('\n');
  const row = (r) =>
    `| ${r.map((v) => String(v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')).join(' | ')} |`;
  return [row(headers), row(headers.map(() => '---')), row(values)].join('\n');
}
