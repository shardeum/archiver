import * as P2P from '../P2P'
import * as Logger from '../Logger'
import * as NodeList from '../NodeList'
import * as Utils from '../Utils'
import { config, updateConfig } from '../Config'
import { robustQuery } from '../Utils'

let currentConsensusRadius = 0
let nodesPerConsensusGroup = 0
let nodesPerEdge = 0

export function getCurrentConsensusRadius(): number {
  return currentConsensusRadius
}

export function setCurrentConsensusRadius(value: number): void {
  currentConsensusRadius = value
}

export async function syncFromNetworkConfig(): Promise<any> {
  try {
    const queryFn = async (node): Promise<object> => {
      const REQUEST_NETCONFIG_TIMEOUT_SECOND = 3
      try {
        const response = await P2P.getJson(`http://${node.ip}:${node.port}/netconfig`, REQUEST_NETCONFIG_TIMEOUT_SECOND)
        return response
      } catch (error) {
        Logger.mainLogger.error(`Error querying node ${node.ip}:${node.port}: ${error}`)
        return null
      }
    }
    const equalityFn = (responseA, responseB): boolean => {
      return responseA?.config?.sharding?.nodesPerConsensusGroup === responseB?.config?.sharding?.nodesPerConsensusGroup
    }
    const nodes = NodeList.getActiveNodeCount() > 0 ? NodeList.getRandomActiveNodes(10) : [NodeList.getFirstNode()]
    const tallyItem = await robustQuery(
      nodes,
      queryFn,
      equalityFn,
      3
    )
    if (tallyItem?.value?.config?.stateManager) {
      const {
        useNewPOQ: newPOQReceipt,
        configChangeMaxChangesToKeep,
        configChangeMaxCyclesToKeep,
        maxCyclesShardDataToKeep,
      } = tallyItem.value.config.stateManager
      
      if (
        !Utils.isUndefined(newPOQReceipt) &&
        typeof newPOQReceipt === typeof config.newPOQReceipt &&
        newPOQReceipt !== config.newPOQReceipt
      )
        updateConfig({ newPOQReceipt })
      if (
        !Utils.isUndefined(configChangeMaxChangesToKeep) &&
        typeof configChangeMaxChangesToKeep === typeof config.configChangeMaxChangesToKeep &&
        configChangeMaxChangesToKeep !== config.configChangeMaxChangesToKeep
      )
        updateConfig({ configChangeMaxChangesToKeep })
      if (
        !Utils.isUndefined(configChangeMaxCyclesToKeep) &&
        typeof configChangeMaxCyclesToKeep === typeof config.configChangeMaxCyclesToKeep &&
        configChangeMaxCyclesToKeep !== config.configChangeMaxCyclesToKeep
      )
        updateConfig({ configChangeMaxCyclesToKeep })
      if (
        !Utils.isUndefined(maxCyclesShardDataToKeep) &&
        typeof maxCyclesShardDataToKeep === typeof config.maxCyclesShardDataToKeep &&
        maxCyclesShardDataToKeep !== config.maxCyclesShardDataToKeep
      )
        updateConfig({ maxCyclesShardDataToKeep })
      return tallyItem
    }
    return null
  } catch (error) {
    Logger.mainLogger.error('❌ Error in syncFromNetworkConfig: ', error)
    return null
  }
}

export async function getConsensusRadius(): Promise<number> {
  if (NodeList.isEmpty()) return currentConsensusRadius

  const tallyItem = await syncFromNetworkConfig()
  if (tallyItem?.value?.config) {
    const nodesPerEdgeFromConfig = tallyItem.value.config.sharding?.nodesPerEdge
    const nodesPerConsensusGroupFromConfig = tallyItem.value.config.sharding?.nodesPerConsensusGroup

    if (!Number.isInteger(nodesPerConsensusGroupFromConfig) || nodesPerConsensusGroupFromConfig <= 0) {
      Logger.mainLogger.error('nodesPerConsensusGroup is not a valid number:', nodesPerConsensusGroupFromConfig)
      return currentConsensusRadius
    }

    if (!Number.isInteger(nodesPerEdgeFromConfig) || nodesPerEdgeFromConfig <= 0) {
      Logger.mainLogger.error('nodesPerEdge is not a valid number:', nodesPerEdgeFromConfig)
      return currentConsensusRadius
    }
    if (nodesPerConsensusGroup === nodesPerConsensusGroupFromConfig && nodesPerEdge === nodesPerEdgeFromConfig)
      return currentConsensusRadius
    nodesPerConsensusGroup = nodesPerConsensusGroupFromConfig
    nodesPerEdge = nodesPerEdgeFromConfig
    if (nodesPerConsensusGroup % 2 === 0) nodesPerConsensusGroup++
    const consensusRadius = Math.floor((nodesPerConsensusGroup - 1) / 2)
    if (typeof consensusRadius !== 'number' || isNaN(consensusRadius) || consensusRadius <= 0) {
      Logger.mainLogger.error('Invalid consensusRadius:', consensusRadius)
      return currentConsensusRadius
    }
    Logger.mainLogger.debug(
      'consensusRadius',
      consensusRadius,
      'nodesPerConsensusGroup',
      nodesPerConsensusGroup,
      'nodesPerEdge',
      nodesPerEdge
    )
    return consensusRadius
  }
  Logger.mainLogger.error('Failed to get consensusRadius from the network')
  return currentConsensusRadius
}