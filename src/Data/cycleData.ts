import { P2P as P2PTypes } from '@shardeus-foundation/lib-types'
import * as Logger from '../Logger'
import * as NodeList from '../NodeList'
import * as State from '../State'
import * as Cycles from './Cycles'
import * as Crypto from '../Crypto'
import { Utils as StringUtils } from '@shardeus-foundation/lib-types'
import { Utils as UtilsTypes } from '@shardeus-foundation/lib-types'
import { nestedCountersInstance } from '../profiler/nestedCounters'
import { config } from '../Config'
import { ArchiverLogging } from '../profiler/archiverLogging'
import { subscriptionCycleData, DataSender } from './types'
import { storeCycleData, processCycles } from './dataSync'
import { cachedCycleRecords, updateCacheFromDB } from '../cache/cycleRecordsCache'
import { getCurrentCycleCounter } from './Cycles'
import { XOR } from '../utils/general'
import { validateCycleData } from './Cycles'
import { validationTracker } from './socketClient'

interface ReceivedCycleTracker {
  [counter: number]: {
    [marker: string]: {
      cycleInfo: P2PTypes.CycleCreatorTypes.CycleData | subscriptionCycleData
      certSigners: Set<string>
    }
  } & {
    received?: number
    saved?: boolean
  }
}

const receivedCycleTracker: ReceivedCycleTracker = {}
const maxCyclesInCycleTracker = 500

export function collectCycleData(
  cycleData: subscriptionCycleData[] | P2PTypes.CycleCreatorTypes.CycleData[],
  senderInfo: string,
  source: string,
  dataSenders?: Map<NodeList.ConsensusNodeInfo['publicKey'], DataSender>
): void {
  const startTime = Date.now()
  const operationId = ArchiverLogging.generateOperationId()

  Logger.mainLogger.debug(
    `collectCycleData: Processing ${cycleData.length} cycles from ${senderInfo}, source: ${source}`
  )

  nestedCountersInstance.countEvent('collectCycleData', 'cycles_received', cycleData.length)
  nestedCountersInstance.countEvent('collectCycleData', 'source_' + source, 1)

  ArchiverLogging.logDataSync({
    sourceArchiver: senderInfo,
    targetArchiver: config.ARCHIVER_IP,
    cycle: 0,
    dataType: 'CYCLE_RECORD',
    dataHash: '',
    status: 'STARTED',
    operationId,
    metrics: {
      duration: 0,
      dataSize: StringUtils.safeStringify(cycleData).length,
    },
  })

  if (NodeList.activeListByIdSorted.length > 0) {
    const [ip, port] = senderInfo.split(':')
    const isInActiveNodes = NodeList.activeListByIdSorted.some(
      (node) => node.ip === ip && node.port.toString() === port
    )
    const isInActiveArchivers = State.activeArchivers.some(
      (archiver) => archiver.ip === ip && archiver.port.toString() === port
    )
    if (!isInActiveNodes && !isInActiveArchivers) {
      nestedCountersInstance.countEvent('collectCycleData', 'sender_not_active', 1)
      Logger.mainLogger.warn(`collectCycleData: Ignoring cycle data from non-active node: ${senderInfo}`)
      ArchiverLogging.logDataSync({
        sourceArchiver: senderInfo,
        targetArchiver: config.ARCHIVER_IP,
        cycle: 0,
        dataType: 'CYCLE_RECORD',
        dataHash: '',
        status: 'ERROR',
        operationId,
        metrics: {
          duration: Date.now() - startTime,
          dataSize: StringUtils.safeStringify(cycleData).length,
        },
        error: 'Sender not in active nodes or archivers',
      })
      return
    }
  }

  for (const cycle of cycleData) {
    Logger.mainLogger.debug(`collectCycleData: Processing cycle ${cycle.counter}, marker: ${cycle.marker}`)

    if (receivedCycleTracker[cycle.counter]?.saved === true) {
      nestedCountersInstance.countEvent('collectCycleData', 'cycle_already_saved_' + cycle.mode, 1)
      Logger.mainLogger.debug(`collectCycleData: Cycle ${cycle.counter} already saved, skipping`)
      ArchiverLogging.logDataSync({
        sourceArchiver: senderInfo,
        targetArchiver: config.ARCHIVER_IP,
        cycle: cycle.counter,
        dataType: 'CYCLE_RECORD',
        dataHash: cycle.marker,
        status: 'COMPLETE',
        operationId,
        metrics: {
          duration: Date.now() - startTime,
          dataSize: StringUtils.safeStringify(cycle).length,
        },
      })
      break
    }

    nestedCountersInstance.countEvent('collectCycleData', 'process_cycle_' + cycle.mode, 1)

    if (source === 'archiver') {
      nestedCountersInstance.countEvent('collectCycleData', 'direct_process_from_archiver', 1)
      Logger.mainLogger.debug(`collectCycleData: Processing cycle ${cycle.counter} from archiver directly`)
      processCycles([cycle as P2PTypes.CycleCreatorTypes.CycleData])
      continue
    }

    let receivedCertSigners = []
    if (NodeList.activeListByIdSorted.length > 0) {
      const certSigners = receivedCycleTracker[cycle.counter]?.[cycle.marker]?.['certSigners'] ?? new Set()

      try {
        Logger.mainLogger.debug(`collectCycleData: Original cycle data: ${UtilsTypes.safeStringify(cycle)}`)
        const cycleCopy = getRecordWithoutPostQ3Changes(cycle)
        const computedMarker = Cycles.computeCycleMarker(cycleCopy)
        Logger.mainLogger.debug(`collectCycleData: cycle copy ${UtilsTypes.safeStringify(cycleCopy)}`)
        Logger.mainLogger.debug(
          `collectCycleData: Computed marker for cycle ${cycle.counter}: ${computedMarker}, original marker: ${cycle.marker}`
        )
        Logger.mainLogger.debug(
          `collectCycleData: Validating ${(cycle as subscriptionCycleData).certificates?.length || 0} certificates for cycle ${cycle.counter}`
        )

        const validateCertsResult = validateCerts(
          (cycle as subscriptionCycleData).certificates,
          certSigners,
          computedMarker,
          cycleCopy as P2PTypes.CycleCreatorTypes.CycleData
        )

        if (validateCertsResult === false) {
          nestedCountersInstance.countEvent('collectCycleData', 'certificate_validation_failed_' + cycle.mode, 1)
          Logger.mainLogger.warn(
            `collectCycleData: Certificate validation failed for cycle ${cycle.counter} from ${senderInfo} in ${cycle.mode} mode`
          )
          ArchiverLogging.logDataSync({
            sourceArchiver: senderInfo,
            targetArchiver: config.ARCHIVER_IP,
            cycle: cycle.counter,
            dataType: 'CYCLE_RECORD',
            dataHash: cycle.marker,
            status: 'ERROR',
            operationId,
            metrics: {
              duration: Date.now() - startTime,
              dataSize: StringUtils.safeStringify(cycle).length,
            },
            error: 'Certificate validation failed',
          })
          break
        }

        nestedCountersInstance.countEvent('collectCycleData', 'certificate_validation_success_' + cycle.mode, 1)
        Logger.mainLogger.debug(`collectCycleData: Certificate validation successful for cycle ${cycle.counter}`)
      } catch (error) {
        nestedCountersInstance.countEvent('collectCycleData', 'certificate_validation_error_' + cycle.mode, 1)
        Logger.mainLogger.error(
          `collectCycleData: Error during certificate validation for cycle ${cycle.counter}: ${error}`
        )
        ArchiverLogging.logDataSync({
          sourceArchiver: senderInfo,
          targetArchiver: config.ARCHIVER_IP,
          cycle: cycle.counter,
          dataType: 'CYCLE_RECORD',
          dataHash: cycle.marker,
          status: 'ERROR',
          operationId,
          metrics: {
            duration: Date.now() - startTime,
            dataSize: StringUtils.safeStringify(cycle).length,
          },
          error: `Certificate validation error: ${error.message}`,
        })
        break
      }
    }

    receivedCertSigners = (cycle as subscriptionCycleData).certificates.map((cert) => cert.sign.owner)
    Logger.mainLogger.debug(
      `collectCycleData: Received ${receivedCertSigners.length} certificate signers for cycle ${cycle.counter}`
    )
    delete (cycle as subscriptionCycleData).certificates

    if (receivedCycleTracker[cycle.counter]) {
      if (receivedCycleTracker[cycle.counter][cycle.marker]) {
        nestedCountersInstance.countEvent('collectCycleData', 'add_signers_to_existing_marker_' + cycle.mode, 1)
        Logger.mainLogger.debug(`collectCycleData: Adding signers to existing marker for cycle ${cycle.counter}`)
        for (const signer of receivedCertSigners)
          receivedCycleTracker[cycle.counter][cycle.marker]['certSigners'].add(signer)
      } else {
        if (!validateCycleData(cycle)) {
          nestedCountersInstance.countEvent('collectCycleData', 'cycle_data_validation_failed_' + cycle.mode, 1)
          Logger.mainLogger.warn(
            `collectCycleData: Cycle data validation failed for cycle ${cycle.counter} with marker ${cycle.marker}`
          )
          ArchiverLogging.logDataSync({
            sourceArchiver: senderInfo,
            targetArchiver: config.ARCHIVER_IP,
            cycle: cycle.counter,
            dataType: 'CYCLE_RECORD',
            dataHash: cycle.marker,
            status: 'ERROR',
            operationId,
            metrics: {
              duration: Date.now() - startTime,
              dataSize: StringUtils.safeStringify(cycle).length,
            },
            error: 'Cycle data validation failed',
          })
          continue
        }
        nestedCountersInstance.countEvent('collectCycleData', 'create_new_marker_entry_' + cycle.mode, 1)
        Logger.mainLogger.debug(
          `collectCycleData: Creating new marker entry for cycle ${cycle.counter} with marker ${cycle.marker}`
        )
        receivedCycleTracker[cycle.counter][cycle.marker] = {
          cycleInfo: cycle,
          certSigners: new Set(receivedCertSigners),
        }
        Logger.mainLogger.debug('Different Cycle Record received', cycle.counter)
      }
      receivedCycleTracker[cycle.counter]['received']++
      Logger.mainLogger.debug(
        `collectCycleData: Cycle ${cycle.counter} received count: ${receivedCycleTracker[cycle.counter]['received']}`
      )
    } else {
      if (!validateCycleData(cycle)) {
        nestedCountersInstance.countEvent('collectCycleData', 'cycle_data_validation_failed_' + cycle.mode, 1)
        Logger.mainLogger.warn(
          `collectCycleData: Cycle data validation failed for cycle ${cycle.counter} with marker ${cycle.marker}`
        )
        ArchiverLogging.logDataSync({
          sourceArchiver: senderInfo,
          targetArchiver: config.ARCHIVER_IP,
          cycle: cycle.counter,
          dataType: 'CYCLE_RECORD',
          dataHash: cycle.marker,
          status: 'ERROR',
          operationId,
          metrics: {
            duration: Date.now() - startTime,
            dataSize: StringUtils.safeStringify(cycle).length,
          },
          error: 'Cycle data validation failed',
        })
        continue
      }
      nestedCountersInstance.countEvent('collectCycleData', 'create_new_cycle_tracker_' + cycle.mode, 1)
      Logger.mainLogger.debug(`collectCycleData: Creating new cycle tracker entry for cycle ${cycle.counter}`)
      receivedCycleTracker[cycle.counter] = {
        [cycle.marker]: {
          cycleInfo: cycle,
          certSigners: new Set(receivedCertSigners),
        },
        received: 1,
        saved: false,
      }
    }
    if (config.VERBOSE) Logger.mainLogger.debug('Cycle received', cycle.counter, receivedCycleTracker[cycle.counter])

    if (NodeList.activeListByIdSorted.length === 0) {
      nestedCountersInstance.countEvent('collectCycleData', 'no_active_nodes_direct_process_' + cycle.mode, 1)
      Logger.mainLogger.debug(`collectCycleData: No active nodes, processing cycle ${cycle.counter} directly`)
      processCycles([receivedCycleTracker[cycle.counter][cycle.marker].cycleInfo])
      continue
    }

    const requiredSenders = dataSenders && dataSenders.size ? Math.ceil(dataSenders.size / 2) : 1
    Logger.mainLogger.debug(
      `collectCycleData: Cycle ${cycle.counter} requires ${requiredSenders} senders, current count: ${receivedCycleTracker[cycle.counter]['received']}`
    )

    if (receivedCycleTracker[cycle.counter]['received'] >= requiredSenders) {
      nestedCountersInstance.countEvent('collectCycleData', 'enough_senders_process_' + cycle.mode, 1)
      Logger.mainLogger.debug(`collectCycleData: Cycle ${cycle.counter} has enough senders, processing`)

      let bestScore = 0
      let bestMarker = ''
      let prevMarker = ''

      if (cachedCycleRecords.length === 0) {
        updateCacheFromDB()
          .then(() => {
            if (cachedCycleRecords.length > 0 && cycle.counter - cachedCycleRecords[0].counter > 1) {
              Logger.mainLogger.debug(`updateCacheFromDB: No previous marker found for cycle ${cycle.counter}`)
            }
            processCycleWithPrevMarker()
          })
          .catch((error) => {
            Logger.mainLogger.error(`updateCacheFromDB: Error updating cache from db: ${error}`)
          })
      } else {
        processCycleWithPrevMarker()
      }

      function processCycleWithPrevMarker() {
        if (cachedCycleRecords.length > 0 && cycle.counter - cachedCycleRecords[0].counter === 1) {
          prevMarker = cachedCycleRecords[0].marker
          Logger.mainLogger.debug(`collectCycleData: Previous marker for scoring: ${prevMarker}`)
        } else {
          Logger.mainLogger.debug(`collectCycleData: No previous marker found for cycle ${cycle.counter}`)
          return
        }
        const markers = Object.entries(receivedCycleTracker[cycle.counter])
          .filter(([key]) => key !== 'saved' && key !== 'received')
          .map(([, value]) => value)

        Logger.mainLogger.debug(
          `collectCycleData: Found ${markers.length} different markers for cycle ${cycle.counter}`
        )

        for (const marker of markers) {
          const scores = []
          for (const signer of marker['certSigners']) {
            const score = scoreCert(signer as string, prevMarker)
            scores.push(score)
            Logger.mainLogger.debug(`collectCycleData: Cert from ${signer} scored ${score}`)
          }
          const sum = scores
            .sort((a, b) => b - a)
            .slice(0, 3)
            .reduce((sum, score) => (sum += score), 0)

          Logger.mainLogger.debug(`collectCycleData: Marker ${marker['cycleInfo'].marker} scored ${sum}`)

          if (sum > bestScore) {
            bestScore = sum
            bestMarker = marker['cycleInfo'].marker
            Logger.mainLogger.debug(`collectCycleData: New best marker: ${bestMarker} with score ${bestScore}`)
          }
        }

        Logger.mainLogger.debug(
          `collectCycleData: Processing cycle ${cycle.counter} with best marker ${bestMarker}, score: ${bestScore}`
        )
        processCycles([receivedCycleTracker[cycle.counter][bestMarker].cycleInfo])
        receivedCycleTracker[cycle.counter]['saved'] = true

        nestedCountersInstance.countEvent('collectCycleData', 'cycle_processed_successfully_' + cycle.mode, 1)

        ArchiverLogging.logDataSync({
          sourceArchiver: senderInfo,
          targetArchiver: config.ARCHIVER_IP,
          cycle: cycle.counter,
          dataType: 'CYCLE_RECORD',
          dataHash: bestMarker,
          status: 'COMPLETE',
          operationId,
          metrics: {
            duration: Date.now() - startTime,
            dataSize: StringUtils.safeStringify(receivedCycleTracker[cycle.counter][bestMarker].cycleInfo).length,
          },
        })
      }
    }
  }

  if (Object.keys(receivedCycleTracker).length > maxCyclesInCycleTracker) {
    nestedCountersInstance.countEvent('collectCycleData', 'cleanup_old_cycles', 1)
    Logger.mainLogger.debug(
      `collectCycleData: Cleaning up old cycles, current count: ${Object.keys(receivedCycleTracker).length}`
    )
    for (const counter of Object.keys(receivedCycleTracker)) {
      if (parseInt(counter) < getCurrentCycleCounter() - maxCyclesInCycleTracker) {
        let totalTimes = receivedCycleTracker[counter]['received']
        let logCycle = false

        const markers = Object.entries(receivedCycleTracker[counter])
          .filter(([key]) => key !== 'saved' && key !== 'received')
          .map(([, value]) => value)

        if (markers.length > 1) {
          logCycle = true
          nestedCountersInstance.countEvent('collectCycleData', 'multiple_markers_for_cycle', 1)
        }

        for (const marker of markers) {
          Logger.mainLogger.debug(
            'Cycle',
            counter,
            marker,
            logCycle ? StringUtils.safeStringify([...receivedCycleTracker[counter][marker]['certSigners']]) : '',
            logCycle ? receivedCycleTracker[counter][marker] : ''
          )
        }
        if (logCycle) Logger.mainLogger.debug(`Cycle ${counter} has ${markers.length} different markers!`)
        Logger.mainLogger.debug(`Received ${totalTimes} times for cycle counter ${counter}`)
        delete receivedCycleTracker[counter]
      }
    }
  }
}

function validateCerts(
  certs: P2PTypes.CycleCreatorTypes.CycleCert[],
  certSigners: Set<string>,
  inpMarker: string,
  cycleData: P2PTypes.CycleCreatorTypes.CycleData
) {
  nestedCountersInstance.countEvent('validateCerts', 'validation', 1)
  Logger.mainLogger.debug(`validateCerts: Validating ${certs.length} certificates against marker ${inpMarker}`)

  for (const cert of certs) {
    const cleanCert: P2PTypes.CycleCreatorTypes.CycleCert = {
      marker: cert.marker,
      sign: cert.sign,
    }
    if (cleanCert.marker !== inpMarker) {
      nestedCountersInstance.countEvent('validateCerts', 'markerMismatch', 1)
      validationTracker.add({ cycle: cycleData })
      return false
    }
    if (NodeList.activeListByIdSorted.some((node) => node.publicKey === cleanCert.sign.owner) === false) {
      nestedCountersInstance.countEvent('validateCerts', 'badOwner', 1)
      Logger.mainLogger.warn(`validateCerts: bad owner ${cleanCert.sign.owner} not found in active nodes`)
      return false
    }
    if (certSigners.has(cert.sign.owner)) {
      nestedCountersInstance.countEvent('validateCerts', 'skipExistingSigner', 1)
      Logger.mainLogger.debug(`validateCerts: Skipping already verified cert from ${cert.sign.owner}`)
      continue
    }
    if (!Crypto.verify(cleanCert)) {
      nestedCountersInstance.countEvent('validateCerts', 'badSignature', 1)
      Logger.mainLogger.warn(`validateCerts: bad signature from ${cleanCert.sign.owner}`)
      return false
    }
    nestedCountersInstance.countEvent('validateCerts', 'validCert', 1)
  }

  Logger.mainLogger.debug(`validateCerts: All certificates validated successfully`)
  return true
}

export function scoreCert(pubKey: string, prevMarker: P2PTypes.CycleCreatorTypes.CycleMarker): number {
  try {
    const node = NodeList.byPublicKey.get(pubKey)
    const id = node.id
    const obj = { id }
    const hid = Crypto.hashObj(obj)

    const out = XOR(prevMarker, hid)

    if (config.nerfNonFoundationCertScores && !node.foundationNode) {
      return out & 0x0fffffff
    }

    return out
  } catch (err) {
    Logger.mainLogger.error('scoreCert ERR:', err)
    return 0
  }
}

function getRecordWithoutPostQ3Changes(cycle: P2PTypes.CycleCreatorTypes.CycleRecord) {
  Logger.mainLogger.debug(`getRecordWithoutPostQ3Changes: Processing cycle ${cycle.counter}`)

  const cycleCopy = StringUtils.safeJsonParse(StringUtils.safeStringify(cycle))
  delete cycleCopy.marker
  delete cycleCopy.certificates
  cycleCopy.nodeListHash = ''
  cycleCopy.archiverListHash = ''
  cycleCopy.standbyNodeListHash = ''
  cycleCopy.joinedConsensors.forEach((jc) => (jc.syncingTimestamp = 0))
  return cycleCopy
}

export async function syncCycleData(cycle: number): Promise<boolean> {
  const MAX_RETRIES = 3
  let retryCount = 0
  let success = false

  Logger.mainLogger.debug(`syncCycleData: Starting sync for cycle ${cycle}`)
  Logger.mainLogger.debug(`syncCycleData: Active nodes count: ${NodeList.activeListByIdSorted.length}`)

  while (!success && retryCount < MAX_RETRIES) {
    try {
      Logger.mainLogger.debug(`syncCycleData: Attempt ${retryCount + 1} for cycle ${cycle}`)

      const res = (await queryFromArchivers(
        RequestDataType.CYCLE,
        {
          start: cycle,
          end: cycle,
        },
        QUERY_TIMEOUT_MAX
      )) as ArchiverCycleResponse

      if (res && res.cycleInfo && res.cycleInfo.length > 0) {
        const cycleData = res.cycleInfo[0]
        Logger.mainLogger.debug(`syncCycleData: Received data for cycle ${cycle}, marker: ${cycleData.marker}`)

        if (!validateCycleData(cycleData)) {
          Logger.mainLogger.error(`syncCycleData: Invalid cycle data for cycle ${cycle}`)
          Logger.mainLogger.error(`syncCycleData: Cycle validation failed, checking marker computation...`)
          nestedCountersInstance.countEvent('archiver', 'cycle_validation_failed - ' + cycle)

          const cycleDataCopy = { ...cycleData }
          delete cycleDataCopy.marker
          const computedMarker = Cycles.computeCycleMarker(cycleDataCopy)
          Logger.mainLogger.error(
            `syncCycleData: Computed marker: ${computedMarker}, received marker: ${cycleData.marker}`
          )

          retryCount++
          continue
        }

        await processCycles([cycleData])
        Logger.mainLogger.debug(`syncCycleData: Successfully synced and processed cycle ${cycle}`)
        success = true
        return true
      } else {
        Logger.mainLogger.error(
          `syncCycleData: Failed to get cycle data for cycle ${cycle}, attempt ${retryCount + 1} of ${MAX_RETRIES}`
        )
        retryCount++
      }
    } catch (error) {
      Logger.mainLogger.error(`syncCycleData: Error syncing cycle data for cycle ${cycle}: ${error}`)
      retryCount++
    }
  }

  Logger.mainLogger.error(`syncCycleData: All attempts to sync cycle ${cycle} failed`)
  return false
}

// Import these from other files to avoid circular dependencies
import { queryFromArchivers } from '../API'
import { RequestDataType, ArchiverCycleResponse } from './types'

const QUERY_TIMEOUT_MAX = 30 // 30seconds