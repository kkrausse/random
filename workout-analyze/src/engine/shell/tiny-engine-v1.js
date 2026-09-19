/* Plain script: evaluate in a dedicated JavaScriptCore global context. */
(function (root) {
  'use strict'
  var BUILD_ID = 'phase1-engine-v1'
  var ALGORITHM_ID = 'phase1-sum-v1'
  var SCALE = 1

  function finiteNumber(value) { return typeof value === 'number' && isFinite(value) }
  function create(checkpoint) {
    var lastSequence = 0
    var total = 0
    if (checkpoint !== null) {
      if (!checkpoint || checkpoint.schemaVersion !== 1 || checkpoint.engineBuildId !== BUILD_ID || checkpoint.algorithmId !== ALGORITHM_ID || !Number.isSafeInteger(checkpoint.lastSequence) || checkpoint.lastSequence < 0 || !finiteNumber(checkpoint.total)) throw new TypeError('incompatible checkpoint')
      lastSequence = checkpoint.lastSequence
      total = checkpoint.total
    }
    return Object.freeze({
      processBatch: function (batch) {
        if (!batch || !Array.isArray(batch.observations) || batch.observations.length > 1000) throw new TypeError('invalid batch')
        var nextSequence = lastSequence
        var nextTotal = total
        for (var i = 0; i < batch.observations.length; i += 1) {
          var item = batch.observations[i]
          if (!item || !Number.isSafeInteger(item.sequence) || item.sequence !== nextSequence + 1 || !finiteNumber(item.value)) throw new TypeError('observations must be finite and contiguous')
          nextSequence = item.sequence
          var candidateTotal = nextTotal + item.value
          if (!finiteNumber(candidateTotal)) throw new TypeError('observations must produce a finite total')
          nextTotal = candidateTotal
        }
        lastSequence = nextSequence
        total = nextTotal
        return Object.freeze({ algorithmId: ALGORITHM_ID, processedCount: batch.observations.length, lastSequence: lastSequence, total: total, displayValue: total * SCALE })
      },
      checkpoint: function () { return Object.freeze({ schemaVersion: 1, engineBuildId: BUILD_ID, algorithmId: ALGORITHM_ID, lastSequence: lastSequence, total: total }) }
    })
  }
  root.WorkoutAnalyzeEngine = Object.freeze({
    describe: function () { return Object.freeze({ apiVersion: 1, checkpointSchemaVersion: 1, engineBuildId: BUILD_ID, algorithmId: ALGORITHM_ID, maxBatchSize: 1000 }) },
    create: create
  })
})(typeof globalThis === 'object' ? globalThis : this)
