const issue = (parserRunId, stagingRecordId, severity, ruleCode, message, details = {}) => ({
  parserRunId, stagingRecordId, severity, ruleCode, message, details,
})

const ratioDifference = (current, previous) => Math.abs(current - previous) / Math.max(Math.abs(previous), 1)

export class IndicatorValidator {
  constructor({ repository }) {
    this.repository = repository
  }

  async validate(parserRunId, records, source) {
    const [definitions, regions] = await Promise.all([
      this.repository.listDefinitions(),
      this.repository.listRegions(),
    ])
    const definitionMap = new Map(definitions.map((definition) => [definition.code, definition]))
    const regionCodes = new Set(regions.map((region) => region.code))
    const issues = []
    const statusById = {}
    const seen = new Set()

    for (const record of records) {
      const definition = definitionMap.get(record.indicatorCode)
      const recordIssues = []
      const uniqueKey = `${record.indicatorCode}:${record.regionCode}:${record.period}`
      if (seen.has(uniqueKey)) recordIssues.push(issue(parserRunId, record.id, 'blocking', 'duplicate_record', `批次内存在重复指标：${uniqueKey}`))
      seen.add(uniqueKey)
      if (!definition) {
        recordIssues.push(issue(parserRunId, record.id, 'blocking', 'unknown_indicator', `未定义指标：${record.indicatorCode}`))
      } else {
        if (record.unit !== definition.defaultUnit) {
          recordIssues.push(issue(parserRunId, record.id, 'blocking', 'unit_changed', `单位 ${record.unit} 与定义单位 ${definition.defaultUnit} 不一致`))
        }
        if (definition.minimumValue !== null && definition.minimumValue !== undefined && record.value < definition.minimumValue) {
          recordIssues.push(issue(parserRunId, record.id, 'error', 'below_minimum', `${definition.name}低于允许范围`, { minimum: definition.minimumValue, value: record.value }))
        }
        if (definition.maximumValue !== null && definition.maximumValue !== undefined && record.value > definition.maximumValue) {
          recordIssues.push(issue(parserRunId, record.id, 'error', 'above_maximum', `${definition.name}高于允许范围`, { maximum: definition.maximumValue, value: record.value }))
        }
        const previous = await this.repository.getLatestRecord(record.indicatorCode, record.regionCode)
        if (previous) {
          const changeRatio = ratioDifference(record.value, previous.value)
          if (changeRatio > definition.reviewChangeRatio) {
            recordIssues.push(issue(parserRunId, record.id, 'warning', 'change_threshold', `${definition.name}较上一正式版本变化超过阈值`, {
              previousPeriod: previous.period,
              previousValue: previous.value,
              currentValue: record.value,
              changeRatio,
              threshold: definition.reviewChangeRatio,
            }))
          }
        }
        if (!source.autoPublish || !definition.autoPublish) {
          recordIssues.push(issue(parserRunId, record.id, 'info', 'manual_review_policy', `${definition.name}按发布策略需要人工审核`))
        }
      }
      if (!regionCodes.has(record.regionCode)) {
        recordIssues.push(issue(parserRunId, record.id, 'blocking', 'unknown_region', `未知行政区代码：${record.regionCode}`))
      }
      const hasBlocking = recordIssues.some((item) => ['blocking', 'error'].includes(item.severity))
      const requiresReview = recordIssues.some((item) => ['warning', 'info'].includes(item.severity))
      statusById[record.id] = hasBlocking ? 'rejected' : requiresReview ? 'review_required' : 'verified'
      issues.push(...recordIssues)
    }

    issues.push(...this.#validateRelationships(parserRunId, records))
    const batchBlocking = issues.filter((item) => item.stagingRecordId === null && ['blocking', 'error'].includes(item.severity))
    if (batchBlocking.length) {
      for (const record of records) statusById[record.id] = 'rejected'
    }

    await Promise.all([
      this.repository.saveValidationIssues(issues),
      this.repository.updateStagingStatuses(statusById),
    ])
    return {
      statusById,
      issues,
      canAutoPublish: Object.values(statusById).every((status) => status === 'verified'),
      requiresReview: Object.values(statusById).some((status) => status === 'review_required'),
      rejected: Object.values(statusById).some((status) => status === 'rejected'),
    }
  }

  #validateRelationships(parserRunId, records) {
    const values = new Map(records.map((record) => [record.indicatorCode, record.value]))
    const issues = []
    const assertNear = (leftCode, rightCodes, tolerance, ruleCode, message) => {
      if (!values.has(leftCode) || rightCodes.some((code) => !values.has(code))) return
      const left = values.get(leftCode)
      const right = rightCodes.reduce((sum, code) => sum + values.get(code), 0)
      if (Math.abs(left - right) > tolerance) {
        issues.push(issue(parserRunId, null, 'blocking', ruleCode, message, { left, right, difference: left - right }))
      }
    }
    assertNear('population_total', ['urban_population', 'rural_population'], 2, 'urban_rural_total', '全国人口不等于城镇与乡村人口之和')
    assertNear('population_total', ['male_population', 'female_population'], 2, 'gender_total', '全国人口不等于男性与女性人口之和')
    assertNear('population_total', ['population_age_0_15', 'population_age_16_59', 'population_age_60_plus'], 3, 'age_total', '全国人口不等于主要年龄分组之和')
    if (values.has('population_total') && values.has('urban_population') && values.has('urbanization_rate')) {
      const calculated = values.get('urban_population') / values.get('population_total') * 100
      if (Math.abs(calculated - values.get('urbanization_rate')) > 0.15) {
        issues.push(issue(parserRunId, null, 'blocking', 'urbanization_formula', '城镇化率与城镇人口/全国人口不一致', { calculated, published: values.get('urbanization_rate') }))
      }
    }
    if (values.has('population_total') && values.has('population_age_65_plus') && values.has('aging_rate')) {
      const calculated = values.get('population_age_65_plus') / values.get('population_total') * 100
      if (Math.abs(calculated - values.get('aging_rate')) > 0.15) {
        issues.push(issue(parserRunId, null, 'blocking', 'aging_formula', '老龄化率与65岁以上人口/全国人口不一致', { calculated, published: values.get('aging_rate') }))
      }
    }
    assertNear('province_population_total', ['province_urban_population', 'province_rural_population'], 2, 'province_urban_rural_total', '省级人口不等于城镇与乡村人口之和')
    if (values.has('province_population_total') && values.has('province_urban_population') && values.has('province_urbanization_rate')) {
      const calculated = values.get('province_urban_population') / values.get('province_population_total') * 100
      if (Math.abs(calculated - values.get('province_urbanization_rate')) > 0.15) {
        issues.push(issue(parserRunId, null, 'blocking', 'province_urbanization_formula', '省级城镇化率与城镇人口/常住人口不一致', { calculated, published: values.get('province_urbanization_rate') }))
      }
    }
    if (values.has('province_birth_rate') && values.has('province_death_rate') && values.has('province_natural_growth_rate')) {
      const calculated = values.get('province_birth_rate') - values.get('province_death_rate')
      if (Math.abs(calculated - values.get('province_natural_growth_rate')) > 0.15) {
        issues.push(issue(parserRunId, null, 'blocking', 'province_natural_growth_formula', '省级人口自然增长率与出生率减死亡率不一致', { calculated, published: values.get('province_natural_growth_rate') }))
      }
    }
    return issues
  }
}
