import { pascalCase } from 'change-case'
import dedent from 'dedent'

import type { Plugin } from '../config'
import type { RequiredBy } from '../types'
import { getAddressDocString } from '../utils'

type ReactConfig = {
  /**
   * Generate `useContract` hook.
   *
   * @default true
   */
  useContract?: boolean
  /**
   * Generate `useContractEvent` hook.
   *
   * @default true
   */
  useContractEvent?: boolean
  /**
   * Generate `useContractEvent` hook for each event in contract ABI.
   *
   * @default true
   */
  useContractItemEvent?: boolean
  /**
   * Generate `useContractRead` hook.
   *
   * @default true
   */
  useContractRead?: boolean
  /**
   * Generate `useContractRead` hook for each "read" function in contract ABI.
   *
   * @default true
   */
  useContractFunctionRead?: boolean
  /**
   * Generate `useContractWrite` hook.
   *
   * @default true
   */
  useContractWrite?: boolean
  /**
   * Generate `useContractWrite` hook for each "write" function in contract ABI.
   *
   * @default true
   */
  useContractFunctionWrite?: boolean
  /**
   * Generate `usePrepareContractWrite` hook.
   *
   * @default true
   */
  usePrepareContractWrite?: boolean
  /**
   * Generate `usePrepareContractWrite` hook for each "write" function in contract ABI.
   *
   * @default true
   */
  usePrepareContractFunctionWrite?: boolean
}

type ReactResult = RequiredBy<Plugin, 'run'>

export function react(config: ReactConfig = {}): ReactResult {
  const hooks = {
    useContract: true,
    useContractEvent: true,
    useContractItemEvent: true,
    useContractRead: true,
    useContractFunctionRead: true,
    useContractWrite: true,
    useContractFunctionWrite: true,
    usePrepareContractWrite: true,
    usePrepareContractFunctionWrite: true,
    ...config,
  }
  return {
    name: 'React',
    async run({ contracts, isTypeScript, outputs }) {
      const imports = new Set<string>([])
      const actionsImports = new Set<string>([])
      const hasWriteContractMode = outputs.some(
        (x) =>
          x.plugin.name === 'Actions' &&
          x.imports?.includes('WriteContractMode'),
      )

      const content: string[] = []
      for (const contract of contracts) {
        const baseHookName = pascalCase(contract.name)

        let typeParams = ''
        let innerContent = ''
        let omitted = ''
        const innerHookParams: Record<string, string> = {
          abi: contract.meta.abiName,
        }
        if (contract.meta.addressName) {
          omitted = `| 'address'`
          if (typeof contract.address === 'object') {
            typeParams = `& { chainId?: keyof typeof ${contract.meta.addressName}  }`
            if (Object.keys(contract.address).length > 1) {
              innerHookParams[
                'address'
              ] = `${contract.meta.addressName}[chainId as keyof typeof ${contract.meta.addressName}]`
              imports.add('useNetwork')
              innerContent = dedent`
                const { chain } = useNetwork()
                const chainId = config.chainId ?? chain?.id
              `
            } else
              innerHookParams['address'] = `${contract.meta.addressName}[${
                Object.keys(contract.address!)[0]
              }]`
          } else if (contract.address)
            innerHookParams['address'] = contract.meta.addressName
        }

        const innerHookConfig =
          Object.entries(innerHookParams).reduce(
            (prev, curr) => `${prev}${curr[0]}: ${curr[1]},`,
            '{',
          ) + '...config}'

        type Item = { name: string; value: string }
        const genDocString = (hookName: string, item?: Item) => {
          let description = `Wraps __{@link ${hookName}}__ with \`abi\` set to __{@link ${contract.meta.abiName}}__`
          if (item)
            description += ` and \`${item.name}\` set to \`"${item.value}"\``
          if (contract.address) {
            const docString = getAddressDocString({ address: contract.address })
            if (docString)
              return dedent`
              /**
              * ${description}.
              * 
              ${docString}
              */
              `
          }
          return dedent`
          /**
           * ${description}.
           */
          `
        }

        if (hooks.useContract) {
          imports.add('useContract')
          const docString = genDocString('useContract')
          let code
          if (isTypeScript) {
            imports.add('UseContractConfig')
            // prettier-ignore
            code = dedent`
            ${docString}
            export function use${baseHookName}(
              config: Omit<UseContractConfig, 'abi'${omitted}>${typeParams} = {} as any,
            ) {
              ${innerContent}
              return useContract(${innerHookConfig})
            }
            `
          } else
            code = dedent`
            ${docString}
            export function use${baseHookName}(config = {}) {
              ${innerContent}
              return useContract(${innerHookConfig})
            }
            `
          content.push(code)
        }

        let hasReadFunction,
          hasWriteFunction,
          hasEvent = false
        for (const component of contract.abi) {
          if (component.type === 'function')
            if (
              component.stateMutability === 'view' ||
              component.stateMutability === 'pure'
            )
              hasReadFunction = true
            else hasWriteFunction = true
          else if (component.type === 'event') hasEvent = true
          // Exit early if all flags are `true`
          if (hasReadFunction && hasWriteFunction && hasEvent) break
        }

        if (hasReadFunction) {
          if (hooks.useContractRead) {
            imports.add('useContractRead')
            const docString = genDocString('useContractRead')
            let code
            if (isTypeScript) {
              imports.add('UseContractReadConfig')
              actionsImports.add('ReadContractResult')
              code = dedent`
              ${docString}
              export function use${baseHookName}Read<
                TFunctionName extends string,
                TSelectData = ReadContractResult<typeof ${contract.meta.abiName}, TFunctionName>
              >(
                config: Omit<UseContractReadConfig<typeof ${contract.meta.abiName}, TFunctionName, TSelectData>, 'abi'${omitted}>${typeParams} = {} as any,
              ) {
                ${innerContent}
                return useContractRead(${innerHookConfig} as UseContractReadConfig<typeof ${contract.meta.abiName}, TFunctionName, TSelectData>)
              }
              `
            } else
              code = dedent`
              ${docString}
              export function use${baseHookName}Read(config = {}) {
                ${innerContent}
                return useContractRead(${innerHookConfig})
              }
              `
            content.push(code)
          }

          if (hooks.useContractFunctionRead) {
            const contractNames = new Set<string>()
            for (const item of contract.abi) {
              if (
                item.type === 'function' &&
                (item.stateMutability === 'view' ||
                  item.stateMutability === 'pure')
              ) {
                // Skip overrides since they are captured by same hook
                if (contractNames.has(item.name)) continue
                contractNames.add(item.name)
                const config =
                  Object.entries({
                    ...innerHookParams,
                    functionName: `'${item.name}'`,
                  }).reduce(
                    (prev, curr) => `${prev}${curr[0]}: ${curr[1]},`,
                    '{',
                  ) + '...config}'
                imports.add('useContractRead')
                const docString = genDocString('useContractRead', {
                  name: 'functionName',
                  value: item.name,
                })
                let code
                if (isTypeScript) {
                  imports.add('UseContractReadConfig')
                  actionsImports.add('ReadContractResult')
                  // prettier-ignore
                  code = dedent`
                  ${docString}
                  export function use${baseHookName}${pascalCase(item.name)}<TSelectData = ReadContractResult<typeof ${contract.meta.abiName}, '${item.name}'>>(
                    config: Omit<UseContractReadConfig<typeof ${contract.meta.abiName}, '${item.name}', TSelectData>, 'abi'${omitted} | 'functionName'>${typeParams} = {} as any,
                  ) {
                    ${innerContent}
                    return useContractRead(${config} as UseContractReadConfig<typeof ${contract.meta.abiName}, '${item.name}', TSelectData>)
                  }
                  `
                } else {
                  // prettier-ignore
                  code = dedent`
                  ${docString}
                  export function use${baseHookName}${pascalCase(item.name)}Read(config = {}) {
                    ${innerContent}
                    return useContractRead(${config})
                  }
                  `
                }
                content.push(code)
              }
            }
          }
        }

        if (hasWriteFunction) {
          if (hooks.useContractWrite) {
            imports.add('useContractWrite')
            const docString = genDocString('useContractWrite')
            let code
            if (isTypeScript) {
              const hasMultichainAddress = typeof contract.address === 'object'
              const TChainId = hasMultichainAddress
                ? `TChainId extends number = keyof typeof ${contract.meta.addressName}`
                : ''
              let typeParams_ = ''
              if (TChainId) {
                imports.add('Address')
                typeParams_ = 'address?: never; chainId?: TChainId;'
              }

              imports.add('UseContractWriteConfig')
              if (!hasWriteContractMode) actionsImports.add('WriteContractMode')
              actionsImports.add('PrepareWriteContractResult')
              // prettier-ignore
              code = dedent`
              ${docString}
              export function use${baseHookName}Write<
                TMode extends WriteContractMode,
                TFunctionName extends string,
                ${TChainId}
              >(
                config: TMode extends 'prepared'
                  ? UseContractWriteConfig<
                      TMode,
                      PrepareWriteContractResult<typeof ${contract.meta.abiName}, string>['abi'],
                      TFunctionName
                    >${TChainId ? ` & { address?: Address; chainId?: TChainId; }` : ''}
                  : UseContractWriteConfig<TMode, typeof ${contract.meta.abiName}, TFunctionName> & {
                      abi?: never
                      ${typeParams_}
                    } = {} as any,
              ) {
                ${innerContent}
                return useContractWrite<TMode, typeof ${contract.meta.abiName}, TFunctionName>(${innerHookConfig} as any)
              }
              `
            } else
              code = dedent`
              ${docString}
              export function use${baseHookName}Write(config = {}) {
                ${innerContent}
                return useContractWrite(${innerHookConfig})
              }
              `
            content.push(code)
          }

          if (hooks.useContractFunctionWrite) {
            const contractNames = new Set<string>()
            for (const item of contract.abi) {
              if (
                item.type === 'function' &&
                (item.stateMutability === 'nonpayable' ||
                  item.stateMutability === 'payable')
              ) {
                // Skip overrides since they are captured by same hook
                if (contractNames.has(item.name)) continue
                contractNames.add(item.name)
                const config =
                  Object.entries({
                    ...innerHookParams,
                    functionName: `'${item.name}'`,
                  }).reduce(
                    (prev, curr) => `${prev}${curr[0]}: ${curr[1]},`,
                    '{',
                  ) + '...config}'
                imports.add('useContractWrite')
                const docString = genDocString('useContractWrite', {
                  name: 'functionName',
                  value: item.name,
                })
                let code
                if (isTypeScript) {
                  const hasMultichainAddress =
                    typeof contract.address === 'object'
                  const TChainId = hasMultichainAddress
                    ? `TChainId extends number = keyof typeof ${contract.meta.addressName}`
                    : ''
                  let preparedTypeParams = `functionName?: '${item.name}'`
                  let unpreparedTypeParams = `functionName?: '${item.name}'`
                  if (TChainId) {
                    imports.add('Address')
                    preparedTypeParams = `address?: Address; chainId?: TChainId; functionName?: '${item.name}'`
                    unpreparedTypeParams = `address?: never; chainId?: TChainId; functionName?: '${item.name}'`
                  }

                  imports.add('UseContractWriteConfig')
                  if (!hasWriteContractMode)
                    actionsImports.add('WriteContractMode')
                  actionsImports.add('PrepareWriteContractResult')
                  // prettier-ignore
                  code = dedent`
                  ${docString}
                  export function use${baseHookName}${pascalCase(item.name)}<
                    TMode extends WriteContractMode,
                    ${TChainId}
                  >(
                    config: TMode extends 'prepared'
                    ? UseContractWriteConfig<
                        TMode,
                        PrepareWriteContractResult<typeof ${contract.meta.abiName}, '${item.name}'>['abi'],
                        '${item.name}'
                      > & {${preparedTypeParams}}
                    : UseContractWriteConfig<TMode, typeof ${contract.meta.abiName}, '${item.name}'> & {
                        abi?: never
                        ${unpreparedTypeParams}
                      } = {} as any,
                  ) {
                    ${innerContent}
                    return useContractWrite<TMode, typeof ${contract.meta.abiName}, '${item.name}'>(${config} as any)
                  }
                  `
                } else {
                  // prettier-ignore
                  code = dedent`
                  ${docString}
                  export function use${baseHookName}${pascalCase(item.name)}(config = {}) {
                    ${innerContent}
                    return useContractWrite(${config})
                  }
                  `
                }
                content.push(code)
              }
            }
          }

          if (hooks.usePrepareContractWrite) {
            imports.add('usePrepareContractWrite')
            const docString = genDocString('usePrepareContractWrite')
            let code
            if (isTypeScript) {
              imports.add('UsePrepareContractWriteConfig')
              // prettier-ignore
              code = dedent`
              ${docString}
              export function usePrepare${baseHookName}Write<
                TFunctionName extends string,
              >(
                config: Omit<UsePrepareContractWriteConfig<typeof ${contract.meta.abiName}, TFunctionName>, 'abi'${omitted}>${typeParams} = {} as any,
              ) {
                ${innerContent}
                return usePrepareContractWrite(${innerHookConfig} as UsePrepareContractWriteConfig<typeof ${contract.meta.abiName}, TFunctionName>)
              }
              `
            } else
              code = dedent`
              ${docString}
              export function usePrepare${baseHookName}Write(config = {}) {
                ${innerContent}
                return usePrepareContractWrite(${innerHookConfig})
              }
              `
            content.push(code)
          }

          if (hooks.usePrepareContractFunctionWrite) {
            const contractNames = new Set<string>()
            for (const item of contract.abi) {
              if (
                item.type === 'function' &&
                (item.stateMutability === 'nonpayable' ||
                  item.stateMutability === 'payable')
              ) {
                // Skip overrides since they are captured by same hook
                if (contractNames.has(item.name)) continue
                contractNames.add(item.name)
                const config =
                  Object.entries({
                    ...innerHookParams,
                    functionName: `'${item.name}'`,
                  }).reduce(
                    (prev, curr) => `${prev}${curr[0]}: ${curr[1]},`,
                    '{',
                  ) + '...config}'
                imports.add('usePrepareContractWrite')
                const docString = genDocString('usePrepareContractWrite', {
                  name: 'functionName',
                  value: item.name,
                })
                let code
                if (isTypeScript) {
                  imports.add('UsePrepareContractWriteConfig')
                  // prettier-ignore
                  code = dedent`
                  ${docString}
                  export function usePrepare${baseHookName}${pascalCase(item.name)}(
                    config: Omit<UsePrepareContractWriteConfig<typeof ${contract.meta.abiName}, '${item.name}'>, 'abi'${omitted} | 'functionName'>${typeParams} = {} as any,
                  ) {
                    ${innerContent}
                    return usePrepareContractWrite(${config} as UsePrepareContractWriteConfig<typeof ${contract.meta.abiName}, '${item.name}'>)
                  }
                  `
                } else {
                  // prettier-ignore
                  code = dedent`
                  ${docString}
                  export function usePrepare${baseHookName}${pascalCase(item.name)}(config = {}) {
                    ${innerContent}
                    return usePrepareContractWrite(${config})
                  }
                  `
                }
                content.push(code)
              }
            }
          }
        }

        if (hasEvent) {
          if (hooks.useContractEvent) {
            imports.add('useContractEvent')
            const docString = genDocString('useContractEvent')
            let code
            if (isTypeScript) {
              imports.add('UseContractEventConfig')
              // prettier-ignore
              code = dedent`
              ${docString}
              export function use${baseHookName}Event<
                TEventName extends string,
              >(
                config: Omit<UseContractEventConfig<typeof ${contract.meta.abiName}, TEventName>, 'abi'${omitted}>${typeParams} = {} as any,
              ) {
                ${innerContent}
                return useContractEvent(${innerHookConfig} as UseContractEventConfig<typeof ${contract.meta.abiName}, TEventName>)
              }
              `
            } else
              code = dedent`
              ${docString}
              export function use${baseHookName}Event(config = {}) {
                ${innerContent}
                return useContractEvent(${innerHookConfig})
              }
              `
            content.push(code)
          }

          if (hooks.useContractItemEvent) {
            const contractNames = new Set<string>()
            for (const item of contract.abi) {
              if (item.type === 'event') {
                // Skip overrides since they are captured by same hook
                if (contractNames.has(item.name)) continue
                contractNames.add(item.name)
                const config =
                  Object.entries({
                    ...innerHookParams,
                    eventName: `'${item.name}'`,
                  }).reduce(
                    (prev, curr) => `${prev}${curr[0]}: ${curr[1]},`,
                    '{',
                  ) + '...config}'
                imports.add('useContractEvent')
                const docString = genDocString('useContractEvent', {
                  name: 'eventName',
                  value: item.name,
                })
                let code
                if (isTypeScript) {
                  imports.add('UseContractEventConfig')
                  // prettier-ignore
                  code = dedent`
                  ${docString}
                  export function use${baseHookName}${pascalCase(item.name)}Event(
                    config: Omit<UseContractEventConfig<typeof ${contract.meta.abiName}, '${item.name}'>, 'abi'${omitted} | 'eventName'>${typeParams} = {} as any,
                  ) {
                    ${innerContent}
                    return useContractEvent(${config} as UseContractEventConfig<typeof ${contract.meta.abiName}, '${item.name}'>)
                  }
                  `
                } else {
                  // prettier-ignore
                  code = dedent`
                  ${docString}
                  export function use${baseHookName}${pascalCase(item.name)}Event(config = {}) {
                    ${innerContent}
                    return useContractEvent(${config})
                  }
                  `
                }
                content.push(code)
              }
            }
          }
        }
      }

      const importValues = [...imports.values()]
      const actionsImportValues = [...actionsImports.values()]
      return {
        imports:
          (importValues.length
            ? `import { ${importValues.join(', ')} } from 'wagmi'\n`
            : '') +
          (actionsImportValues.length
            ? `import { ${actionsImportValues.join(
                ', ',
              )} } from 'wagmi/actions'`
            : ''),
        content: content.join('\n\n'),
      }
    },
  }
}
