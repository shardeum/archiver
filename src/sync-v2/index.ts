/**
 * SyncV2 a p2p module that contains all of the functionality for the new
 * Node List Sync v2.
 */

import { okAsync, errAsync, ResultAsync } from 'neverthrow'
import { hexstring, P2P as P2PTypes } from '@shardeum-foundation/lib-types'
import {
  getCurrentCycleDataFromNode,
  robustQueryForCycleRecordHash,
  robustQueryForValidatorListHash,
  getValidatorListFromNode,
  robustQueryForStandbyNodeListHash,
  getStandbyNodeListFromNode,
  robustQueryForArchiverListHash,
  getArchiverListFromNode,
  robustQueryForTxListHash,
  getTxListFromNode,
} from './queries'
import { ArchiverNodeInfo, resetActiveArchivers } from '../State'
import { getActiveNodeListFromArchiver } from '../NodeList'
import * as NodeList from '../NodeList'
import { verifyArchiverList, verifyCycleRecord, verifyValidatorList, verifyTxList } from './verify'
import * as Logger from '../Logger'
import * as ServiceQueue from '../ServiceQueue'
import { ArchiverLogging } from '../profiler/archiverLogging'
import { config } from '../Config'

/**
 * Given a list of archivers, queries each one until one returns an active node list.
 *
 * The endpoint queried does not return a *full* list of nodes. It's a partial
 * list that will be enough to use in robust queries.
 */
async function getActiveListFromSomeArchiver(
  archivers: ArchiverNodeInfo[],
  operationId: string
): Promise<P2PTypes.SyncTypes.ActiveNode[]> {
  const startTime = Date.now()
  ArchiverLogging.logDataSync({
    sourceArchiver: archivers[0].ip,
    targetArchiver: config.ARCHIVER_IP,
    cycle: 0,
    dataType: 'ARCHIVER_LIST',
    dataHash: '',
    status: 'STARTED',
    operationId,
    metrics: {
      duration: 0,
      dataSize: 0,
    },
  })

  for (const archiver of archivers) {
    try {
      const nodeList = await getActiveNodeListFromArchiver(archiver)
      if (nodeList) {
        ArchiverLogging.logDataSync({
          sourceArchiver: archiver.ip,
          targetArchiver: config.ARCHIVER_IP,
          cycle: 0,
          dataType: 'ARCHIVER_LIST',
          dataHash: '',
          status: 'IN_PROGRESS',
          operationId,
          metrics: {
            duration: Date.now() - startTime,
            dataSize: JSON.stringify(nodeList).length,
          },
        })
        return nodeList
      }
    } catch (e) {
      console.warn(`failed to get active node list from archiver ${archiver.ip}:${archiver.port}: ${e}`)
      ArchiverLogging.logDataSync({
        sourceArchiver: archiver.ip,
        targetArchiver: config.ARCHIVER_IP,
        cycle: 0,
        dataType: 'ARCHIVER_LIST',
        dataHash: '',
        status: 'ERROR',
        operationId,
        metrics: {
          duration: Date.now() - startTime,
          dataSize: 0,
        },
        error: e.message,
      })
      continue
    }
  }

  // all archivers have failed at this point
  throw new Error('no archiver could return an active node list')
}

/**
 * Synchronizes the NodeList and gets the latest CycleRecord from other validators.
 */
export function syncV2(activeArchivers: ArchiverNodeInfo[]): ResultAsync<P2PTypes.CycleCreatorTypes.CycleData, Error> {
  const startTime = Date.now()
  const operationId = ArchiverLogging.generateOperationId()

  return ResultAsync.fromPromise(getActiveListFromSomeArchiver(activeArchivers, operationId), (e: Error) => e).andThen(
    (nodeList) =>
      syncValidatorList(nodeList, operationId).andThen(([validatorList, validatorListHash]) =>
        syncArchiverList(nodeList, operationId).andThen(([archiverList, archiverListHash]) =>
          syncStandbyNodeList(nodeList, operationId).andThen(([standbyList, standbyListHash]) =>
            syncTxList(nodeList, operationId).andThen((txList) =>
              syncLatestCycleRecordAndMarker(nodeList, operationId).andThen(([cycle, cycleMarker]) => {
                Logger.mainLogger.debug('syncV2: validatorList', validatorList)

                ArchiverLogging.logDataSync({
                  sourceArchiver: nodeList[0].ip,
                  targetArchiver: config.ARCHIVER_IP,
                  cycle: cycle.counter,
                  dataType: 'CYCLE_RECORD',
                  dataHash: cycleMarker,
                  status: 'COMPLETE',
                  operationId,
                  metrics: {
                    duration: Date.now() - startTime,
                    dataSize: JSON.stringify({
                      validatorList,
                      archiverList,
                      standbyList,
                      txList,
                      cycle,
                    }).length,
                  },
                })

                // additional checks to make sure the list hashes in the cycle
                // matches the hash for the validator list retrieved earlier
                if (cycle.nodeListHash !== validatorListHash) {
                  ArchiverLogging.logDataSync({
                    sourceArchiver: nodeList[0].ip,
                    targetArchiver: config.ARCHIVER_IP,
                    cycle: cycle.counter,
                    dataType: 'VALIDATOR_LIST',
                    dataHash: validatorListHash,
                    status: 'ERROR',
                    operationId,
                    metrics: {
                      duration: Date.now() - startTime,
                      dataSize: JSON.stringify(validatorList).length,
                    },
                    error: `validator list hash from received cycle (${cycle.nodeListHash}) does not match the hash received from robust query (${validatorListHash})`,
                  })
                  return errAsync(
                    new Error(
                      `validator list hash from received cycle (${cycle.nodeListHash}) does not match the hash received from robust query (${validatorListHash})`
                    )
                  )
                }
                if (cycle.standbyNodeListHash !== standbyListHash) {
                  ArchiverLogging.logDataSync({
                    sourceArchiver: nodeList[0].ip,
                    targetArchiver: config.ARCHIVER_IP,
                    cycle: cycle.counter,
                    dataType: 'STANDBY_LIST',
                    dataHash: standbyListHash,
                    status: 'ERROR',
                    operationId,
                    metrics: {
                      duration: Date.now() - startTime,
                      dataSize: JSON.stringify(standbyList).length,
                    },
                    error: `standby list hash from received cycle (${cycle.standbyNodeListHash}) does not match the hash received from robust query (${standbyListHash})`,
                  })
                  return errAsync(
                    new Error(
                      `standby list hash from received cycle (${cycle.nodeListHash}) does not match the hash received from robust query (${validatorListHash})`
                    )
                  )
                }
                if (cycle.archiverListHash !== archiverListHash) {
                  ArchiverLogging.logDataSync({
                    sourceArchiver: nodeList[0].ip,
                    targetArchiver: config.ARCHIVER_IP,
                    cycle: cycle.counter,
                    dataType: 'ARCHIVER_LIST',
                    dataHash: archiverListHash,
                    status: 'ERROR',
                    operationId,
                    metrics: {
                      duration: Date.now() - startTime,
                      dataSize: JSON.stringify(archiverList).length,
                    },
                    error: `archiver list hash from received cycle (${cycle.archiverListHash}) does not match the hash received from robust query (${archiverListHash})`,
                  })
                  return errAsync(
                    new Error(
                      `archiver list hash from received cycle (${cycle.archiverListHash}) does not match the hash received from robust query (${archiverListHash})`
                    )
                  )
                }

                // validatorList and standbyList need to be transformed into a ConsensusNodeInfo[]
                const syncingNodeList: NodeList.ConsensusNodeInfo[] = []
                const activeNodeList: NodeList.ConsensusNodeInfo[] = []

                for (const node of validatorList) {
                  if (node.status === 'selected' || node.status === 'syncing' || node.status === 'ready') {
                    syncingNodeList.push({
                      publicKey: node.publicKey,
                      ip: node.externalIp,
                      port: node.externalPort,
                      id: node.id,
                    })
                  } else if (node.status === 'active') {
                    activeNodeList.push({
                      publicKey: node.publicKey,
                      ip: node.externalIp,
                      port: node.externalPort,
                      id: node.id,
                    })
                  }
                }
                const standbyNodeList: NodeList.ConsensusNodeInfo[] = standbyList.map((joinRequest) => ({
                  publicKey: joinRequest.nodeInfo.publicKey,
                  ip: joinRequest.nodeInfo.externalIp,
                  port: joinRequest.nodeInfo.externalPort,
                }))
                NodeList.addNodes(NodeList.NodeStatus.SYNCING, syncingNodeList)
                NodeList.addNodes(NodeList.NodeStatus.ACTIVE, activeNodeList)
                NodeList.addStandbyNodes(standbyNodeList)

                // add txList
                ServiceQueue.setTxList(txList)

                // reset the active archivers list with the new list
                resetActiveArchivers(archiverList)

                // return a cycle that we'll store in the database
                return okAsync({
                  ...cycle,
                  marker: cycleMarker,
                })
              })
            )
          )
        )
      )
  )
}

/**
 * This function synchronizes a validator list from `activeNodes`.
 *
 * @param {P2PTypes.SyncTypes.ActiveNode[]} activeNodes - An array of active nodes to be queried.
 * The function first performs a robust query for the latest node list hash.
 * After obtaining the hash, it retrieves the full node list from one of the winning nodes.
 *
 * @returns {ResultAsync<P2PTypes.NodeListTypes.Node[], Error>} - A ResultAsync object. On success, it will contain
 * an array of Node objects, and on error, it will contain an Error object. The function is asynchronous
 * and can be awaited.
 */
function syncValidatorList(
  activeNodes: P2PTypes.SyncTypes.ActiveNode[],
  operationId: string
): ResultAsync<[P2PTypes.NodeListTypes.Node[], hexstring], Error> {
  const startTime = Date.now()
  ArchiverLogging.logDataSync({
    sourceArchiver: activeNodes[0].ip,
    targetArchiver: config.ARCHIVER_IP,
    cycle: 0,
    dataType: 'VALIDATOR_LIST',
    dataHash: '',
    status: 'STARTED',
    operationId,
    metrics: {
      duration: 0,
      dataSize: 0,
    },
  })

  return robustQueryForValidatorListHash(activeNodes).andThen(({ value, winningNodes }) =>
    getValidatorListFromNode(winningNodes[0], value.nodeListHash).andThen((validatorList) =>
      verifyValidatorList(validatorList, value.nodeListHash).map(() => {
        ArchiverLogging.logDataSync({
          sourceArchiver: activeNodes[0].ip,
          targetArchiver: config.ARCHIVER_IP,
          cycle: 0,
          dataType: 'VALIDATOR_LIST',
          dataHash: value.nodeListHash,
          status: 'IN_PROGRESS',
          operationId,
          metrics: {
            duration: Date.now() - startTime,
            dataSize: JSON.stringify(validatorList).length,
          },
        })
        return [validatorList, value.nodeListHash] as [P2PTypes.NodeListTypes.Node[], hexstring]
      })
    )
  )
}

/**
 * This function synchronizes a standby node list from `activeNodes`.
 *
 * @param {P2PTypes.SyncTypes.ActiveNode[]} activeNodes - An array of active nodes to be queried.
 * The function first performs a robust query for the latest node list hash.
 * After obtaining the hash, it retrieves the full node list from one of the winning nodes.
 *
 * @returns {ResultAsync<P2PTypes.NodeListTypes.Node[], Error>} - A ResultAsync object. On success, it will contain
 * an array of Node objects, and on error, it will contain an Error object. The function is asynchronous
 * and can be awaited.
 */
function syncStandbyNodeList(
  activeNodes: P2PTypes.SyncTypes.ActiveNode[],
  operationId: string
): ResultAsync<[P2PTypes.JoinTypes.JoinRequest[], hexstring], Error> {
  const startTime = Date.now()
  ArchiverLogging.logDataSync({
    sourceArchiver: activeNodes[0].ip,
    targetArchiver: config.ARCHIVER_IP,
    cycle: 0,
    dataType: 'STANDBY_LIST',
    dataHash: '',
    status: 'STARTED',
    operationId,
    metrics: {
      duration: 0,
      dataSize: 0,
    },
  })

  return robustQueryForStandbyNodeListHash(activeNodes).andThen(({ value, winningNodes }) =>
    getStandbyNodeListFromNode(winningNodes[0], value.standbyNodeListHash).andThen((standbyList) => {
      ArchiverLogging.logDataSync({
        sourceArchiver: activeNodes[0].ip,
        targetArchiver: config.ARCHIVER_IP,
        cycle: 0,
        dataType: 'STANDBY_LIST',
        dataHash: value.standbyNodeListHash,
        status: 'IN_PROGRESS',
        operationId,
        metrics: {
          duration: Date.now() - startTime,
          dataSize: JSON.stringify(standbyList).length,
        },
      })
      return okAsync([standbyList, value.standbyNodeListHash] as [P2PTypes.JoinTypes.JoinRequest[], hexstring])
    })
  )
}

export function syncTxList(
  activeNodes: P2PTypes.SyncTypes.ActiveNode[],
  operationId: string
): ResultAsync<P2PTypes.ServiceQueueTypes.NetworkTxEntry[], Error> {
  const startTime = Date.now()
  ArchiverLogging.logDataSync({
    sourceArchiver: activeNodes[0].ip,
    targetArchiver: config.ARCHIVER_IP,
    cycle: 0,
    dataType: 'TX_LIST',
    dataHash: '',
    status: 'STARTED',
    operationId,
    metrics: {
      duration: 0,
      dataSize: 0,
    },
  })

  return robustQueryForTxListHash(activeNodes).andThen(({ value, winningNodes }) =>
    getTxListFromNode(winningNodes[0], value.txListHash).andThen((txList) =>
      verifyTxList(txList, value.txListHash).map(() => {
        ArchiverLogging.logDataSync({
          sourceArchiver: activeNodes[0].ip,
          targetArchiver: config.ARCHIVER_IP,
          cycle: 0,
          dataType: 'TX_LIST',
          dataHash: value.txListHash,
          status: 'IN_PROGRESS',
          operationId,
          metrics: {
            duration: Date.now() - startTime,
            dataSize: JSON.stringify(txList).length,
          },
        })
        return txList
      })
    )
  )
}

/**
 * Synchronizes the latest cycle record from a list of active nodes.
 *
 * @param {P2PTypes.SyncTypes.ActiveNode[]} activeNodes - An array of active nodes to be queried.
 * The function first performs a robust query for the latest cycle record hash.
 * After obtaining the hash, it retrieves the current cycle data from one of the winning nodes.
 *
 * @returns {ResultAsync<P2PTypes.CycleCreatorTypes.CycleRecord, Error>} - A ResultAsync object.
 * On success, it will contain a CycleRecord object, and on error, it will contain an Error object.
 * The function is asynchronous and can be awaited.
 */
function syncLatestCycleRecordAndMarker(
  activeNodes: P2PTypes.SyncTypes.ActiveNode[],
  operationId: string
): ResultAsync<[P2PTypes.CycleCreatorTypes.CycleData, P2PTypes.CycleCreatorTypes.CycleMarker], Error> {
  const startTime = Date.now()
  ArchiverLogging.logDataSync({
    sourceArchiver: activeNodes[0].ip,
    targetArchiver: config.ARCHIVER_IP,
    cycle: 0,
    dataType: 'CYCLE_RECORD',
    dataHash: '',
    status: 'STARTED',
    operationId,
    metrics: {
      duration: 0,
      dataSize: 0,
    },
  })

  return robustQueryForCycleRecordHash(activeNodes).andThen(({ value, winningNodes }) =>
    getCurrentCycleDataFromNode(winningNodes[0], value.currentCycleHash).andThen((cycle) =>
      verifyCycleRecord(cycle, value.currentCycleHash).map(() => {
        ArchiverLogging.logDataSync({
          sourceArchiver: activeNodes[0].ip,
          targetArchiver: config.ARCHIVER_IP,
          cycle: cycle.counter,
          dataType: 'CYCLE_RECORD',
          dataHash: value.currentCycleHash,
          status: 'IN_PROGRESS',
          operationId,
          metrics: {
            duration: Date.now() - startTime,
            dataSize: JSON.stringify(cycle).length,
          },
        })
        return [cycle, value.currentCycleHash] as [
          P2PTypes.CycleCreatorTypes.CycleData,
          P2PTypes.CycleCreatorTypes.CycleMarker,
        ]
      })
    )
  )
}

/**
 * This function queries for an archiver list from other active nodes.
 *
 * @param {P2P.SyncTypes.ActiveNode[]} activeNodes - An array of active nodes to be queried.
 * The function first performs a robust query for the latest archiver list hash.
 * Then, it requests a full list from one of the winning nodes using the hash
 * retrieved. The node receiving the request may or may not have the list whose
 * hash matches the one requested.
 *
 * @returns {ResultAsync<[P2P.ArchiversTypes.JoinedArchiver[], hexstring], Error>} - A ResultAsync object. On success, it will contain an array of
 * JoinedArchiver objects and the archiver list hash, and on error, it will contain an Error object. The function is asynchronous and can be awaited.
 */
function syncArchiverList(
  activeNodes: P2PTypes.SyncTypes.ActiveNode[],
  operationId: string
): ResultAsync<[P2PTypes.ArchiversTypes.JoinedArchiver[], hexstring], Error> {
  const startTime = Date.now()
  ArchiverLogging.logDataSync({
    sourceArchiver: activeNodes[0].ip,
    targetArchiver: config.ARCHIVER_IP,
    cycle: 0,
    dataType: 'ARCHIVER_LIST',
    dataHash: '',
    status: 'STARTED',
    operationId,
    metrics: {
      duration: 0,
      dataSize: 0,
    },
  })

  // run a robust query for the lastest archiver list hash
  return robustQueryForArchiverListHash(activeNodes).andThen(({ value, winningNodes }) =>
    // get full archiver list from one of the winning nodes
    getArchiverListFromNode(winningNodes[0], value.archiverListHash).andThen((archiverList) =>
      // verify a hash of the retrieved archiver list matches the hash from before.
      // if it does, return the archiver list
      verifyArchiverList(archiverList, value.archiverListHash).map(() => {
        ArchiverLogging.logDataSync({
          sourceArchiver: activeNodes[0].ip,
          targetArchiver: config.ARCHIVER_IP,
          cycle: 0,
          dataType: 'ARCHIVER_LIST',
          dataHash: value.archiverListHash,
          status: 'IN_PROGRESS',
          operationId,
          metrics: {
            duration: Date.now() - startTime,
            dataSize: JSON.stringify(archiverList).length,
          },
        })
        return [archiverList, value.archiverListHash] as [P2PTypes.ArchiversTypes.JoinedArchiver[], hexstring]
      })
    )
  )
}
