export function createRampController(profile, overrideConcurrency) {
  const maxConcurrency = overrideConcurrency ?? profile.concurrency

  return {
    getConcurrency(elapsedSeconds) {
      if (!profile.rampStages?.length) {
        return maxConcurrency
      }

      for (const stage of profile.rampStages) {
        if (elapsedSeconds < stage.untilSeconds) {
          return Math.min(stage.concurrency, maxConcurrency)
        }
      }

      return maxConcurrency
    },
  }
}
