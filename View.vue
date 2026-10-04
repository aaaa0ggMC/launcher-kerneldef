<script setup lang="ts">
defineOptions({ name: 'cockpit-kerneldef' })

import { computed, inject, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import type { Ref } from 'vue'
import { translate, translateTemplate } from '@ui/i18n'
import { loadGameAssets } from './game/assets'
import { KernelDefense, VIEW } from './game/engine'
import { emptyUiState } from './game/types'
import type { KernelDefStats, TowerType, UiState } from './game/types'
import { TOWERS, TOWER_ORDER } from './game/levels'
import { towerColor } from './game/sprites'

const uiLang = inject('cockpit:lang', ref('zh')) as Ref<string>
const t = (key: string, fallback?: string): string => translate(uiLang.value, key, fallback)
const te = (key: string, vars: Record<string, string | number>): string =>
  translateTemplate(
    uiLang.value,
    key,
    Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, String(v)]))
  )

const stage = ref<HTMLDivElement | undefined>()
const cv = ref<HTMLCanvasElement | undefined>()
const ready = ref(false)
const failed = ref('')
const ui = ref<UiState>(emptyUiState())

const muted = ref(localStorage.getItem('kerneldef_muted') === '1')
const storedVol = localStorage.getItem('kerneldef_volume')
const volume = ref(storedVol === null ? 70 : Math.max(0, Math.min(100, Number(storedVol) || 0)))
const resetOpen = ref(false)
const resetting = ref(false)

const game = shallowRef<KernelDefense | null>(null)
let ro: ResizeObserver | null = null
const inGame = computed(() => ui.value.phase === 'prep' || ui.value.phase === 'wave')

const integrityColor = computed(() =>
  ui.value.integrity > 50 ? 'success' : ui.value.integrity > 25 ? 'warning' : 'error'
)
const tempColor = computed(() =>
  ui.value.temp > 126 ? 'error' : ui.value.temp > 92 ? 'warning' : 'info'
)
const powerFull = computed(() => ui.value.load >= ui.value.capacity)

function fit(): void {
  const s = stage.value
  const canvas = cv.value
  if (!s || !canvas) return
  const scale = Math.min(s.clientWidth / VIEW.w, s.clientHeight / VIEW.h, 2)
  canvas.style.width = `${Math.floor(VIEW.w * scale)}px`
  canvas.style.height = `${Math.floor(VIEW.h * scale)}px`
}

function onVolume(v: number | number[]): void {
  const n = Array.isArray(v) ? v[0] : v
  if (n === undefined) return
  volume.value = n
  localStorage.setItem('kerneldef_volume', String(Math.round(n)))
  game.value?.setVolume(n / 100)
}

function giveBackFocus(): void {
  ;(document.activeElement as HTMLElement | null)?.blur()
  cv.value?.focus({ preventScroll: true })
}

function toggleMute(): void {
  giveBackFocus()
  muted.value = !muted.value
  localStorage.setItem('kerneldef_muted', muted.value ? '1' : '0')
  game.value?.setMuted(muted.value)
}

async function resetData(): Promise<void> {
  resetting.value = true
  try {
    await window.cockpit.command('kerneldef.reset', { confirm: true })
  } catch (e) {
    console.error('kerneldef.reset failed', e)
  } finally {
    resetting.value = false
    resetOpen.value = false
    giveBackFocus()
  }
}

function pick(type: TowerType): void {
  game.value?.setBuildType(type)
}
const startWave = (): void => game.value?.startWave()
const overclock = (): void => game.value?.overclock()
const buyPsu = (): void => game.value?.buyPsu()
const repairCore = (): void => game.value?.repair()
const togglePause = (): void => game.value?.togglePause()
const upgradeSelected = (): void => game.value?.upgradeSelected()
const sellSelected = (): void => game.value?.sellSelected()

onMounted(async () => {
  try {
    const assets = await loadGameAssets()
    if (!cv.value || !stage.value) return
    game.value = new KernelDefense(cv.value, assets, {
      t,
      te,
      record: async (r) => {
        try {
          const res = (await window.cockpit.command('kerneldef.record', { ...r })) as {
            ok?: boolean
          } | null
          if (!res?.ok) return null
          return (await window.cockpit.command('kerneldef.stats')) as KernelDefStats
        } catch (e) {
          console.error('kerneldef.record failed', e)
          return null
        }
      },
      getStats: async () => (await window.cockpit.command('kerneldef.stats')) as KernelDefStats,
      onState: (s) => (ui.value = s)
    })
    await game.value.init()
    game.value.setVolume(volume.value / 100)
    game.value.setMuted(muted.value)
    game.value.start()
    ready.value = true
    fit()
    ro = new ResizeObserver(fit)
    ro.observe(stage.value)
  } catch (e) {
    console.error('kerneldef init failed', e)
    failed.value = String(e)
  }
})

onBeforeUnmount(() => {
  ro?.disconnect()
  ro = null
  game.value?.destroy()
  game.value = null
})
</script>

<template>
  <div class="d-flex flex-column" style="height: 100%">
    <div v-if="inGame" class="kd-toolbar d-flex flex-column ga-2 pb-3">
      <!-- 状态 -->
      <div class="d-flex align-center ga-2 flex-wrap">
        <v-chip color="primary" variant="tonal" class="kd-chip">
          {{ t('kerneldef.hud.wave') }} {{ ui.wave }}
        </v-chip>
        <v-chip :color="integrityColor" variant="tonal" class="kd-chip">
          {{ t('kerneldef.hud.integrity') }} {{ ui.integrity }}/{{ ui.maxIntegrity }}
        </v-chip>
        <v-chip color="amber" variant="tonal" class="kd-chip">
          {{ t('kerneldef.hud.compute') }} {{ ui.compute }}
        </v-chip>
        <v-chip :color="powerFull ? 'error' : 'cyan'" variant="tonal" class="kd-chip">
          {{ t('kerneldef.hud.power') }} {{ ui.load }}/{{ ui.capacity }}
        </v-chip>
        <v-chip :color="tempColor" variant="tonal" class="kd-chip">
          {{ t('kerneldef.hud.temp') }} {{ ui.temp }}°C
          <span v-if="ui.temp > 126"> · {{ t('kerneldef.hud.overheat') }}</span>
          <span v-else-if="ui.temp > 92"> · {{ t('kerneldef.hud.throttle') }}</span>
        </v-chip>
        <v-chip v-if="ui.overclockActive" color="success" variant="flat" class="kd-chip">
          {{ t('kerneldef.hud.ocOn') }}
        </v-chip>
        <v-spacer />
        <span class="text-caption text-medium-emphasis">{{ t('kerneldef.hint') }}</span>
      </div>

      <!-- 建造 / 操作 -->
      <div class="d-flex align-center ga-2 flex-wrap">
        <v-btn
          v-for="(type, i) in TOWER_ORDER"
          :key="type"
          :color="towerColor(type)"
          :variant="ui.buildType === type ? 'flat' : 'tonal'"
          @click="pick(type)"
        >
          <span class="kd-btn-label">
            {{ t('kerneldef.tower.' + type + '.name') }}
            <span class="kd-cost">⌘{{ TOWERS[type].cost }} · ⚡{{ TOWERS[type].load }}</span>
            <span class="kd-key">{{ i + 1 }}</span>
          </span>
        </v-btn>

        <v-divider vertical class="mx-1" />

        <v-btn
          color="success"
          variant="flat"
          prepend-icon="mdi-play"
          :disabled="ui.phase !== 'prep'"
          @click="startWave"
        >
          {{
            ui.phase === 'prep'
              ? t('kerneldef.btn.startWave') + ' (' + Math.ceil((ui.prepMs ?? 0) / 1000) + 's)'
              : t('kerneldef.btn.waveRunning')
          }}
        </v-btn>
        <v-btn
          color="cyan"
          variant="tonal"
          prepend-icon="mdi-flash"
          :disabled="!ui.overclockReady"
          @click="overclock"
        >
          {{
            ui.overclockReady
              ? t('kerneldef.btn.overclock')
              : te('kerneldef.btn.ocCd', { n: ui.overclockCd })
          }}
        </v-btn>
        <v-btn
          color="purple"
          variant="tonal"
          prepend-icon="mdi-expansion-card"
          :disabled="ui.psuCost === null"
          @click="buyPsu"
        >
          {{
            ui.psuCost === null
              ? t('kerneldef.btn.psuMax')
              : te('kerneldef.btn.psu', { n: ui.psuCost })
          }}
        </v-btn>
        <v-btn
          color="teal"
          variant="tonal"
          prepend-icon="mdi-wrench-outline"
          :disabled="!ui.canRepair"
          @click="repairCore"
        >
          {{ te('kerneldef.btn.repair', { n: ui.repairCost }) }}
        </v-btn>
        <v-btn
          variant="tonal"
          :prepend-icon="ui.paused ? 'mdi-play' : 'mdi-pause'"
          @click="togglePause"
        >
          {{ ui.paused ? t('kerneldef.btn.resume') : t('kerneldef.btn.pause') }}
        </v-btn>

        <v-spacer />

        <span class="text-caption text-medium-emphasis">
          {{ t('kerneldef.hud.sigkill') }}
          {{ ui.sigkillReady ? t('kerneldef.ready') : ui.sigkillCd + 's' }}
        </span>
      </div>

      <!-- 选中塔（始终占位，避免建造/选择时画布跳位） -->
      <div class="d-flex align-center ga-2 flex-wrap kd-selected">
        <template v-if="ui.tower">
          <v-chip :color="towerColor(ui.tower.type)" variant="flat" class="kd-chip">
            {{ t('kerneldef.tower.' + ui.tower.type + '.name') }} · Lv{{ ui.tower.level }}
          </v-chip>
          <v-btn
            color="success"
            variant="tonal"
            prepend-icon="mdi-arrow-up-bold"
            :disabled="ui.tower.level >= 3 || ui.compute < ui.tower.upgradeCost"
            @click="upgradeSelected"
          >
            {{ t('kerneldef.btn.upgrade') }} ⌘{{ ui.tower.upgradeCost }}
          </v-btn>
          <v-btn
            color="error"
            variant="tonal"
            prepend-icon="mdi-delete-outline"
            @click="sellSelected"
          >
            {{ t('kerneldef.btn.sell') }} +⌘{{ ui.tower.sellValue }}
          </v-btn>
        </template>
        <span v-else class="text-caption text-medium-emphasis">
          {{ t('kerneldef.selectedHint') }}
        </span>
      </div>
    </div>

    <div class="kd-toolbar d-flex align-center flex-wrap ga-2 pb-3">
      <v-btn
        variant="text"
        :icon="muted ? 'mdi-volume-off' : 'mdi-volume-high'"
        :title="muted ? t('kerneldef.soundOn') : t('kerneldef.soundOff')"
        :aria-label="muted ? t('kerneldef.soundOn') : t('kerneldef.soundOff')"
        @click="toggleMute"
      />
      <v-slider
        :model-value="volume"
        :min="0"
        :max="100"
        :step="1"
        hide-details
        :width="140"
        :aria-label="t('kerneldef.volume')"
        @update:model-value="onVolume"
        @end="giveBackFocus"
      />
      <v-btn
        variant="text"
        prepend-icon="mdi-delete-sweep-outline"
        :disabled="!ready"
        @click="resetOpen = true"
      >
        {{ t('kerneldef.reset.button') }}
      </v-btn>
      <v-spacer />
      <span class="text-caption text-medium-emphasis text-no-wrap">{{ t('kerneldef.title') }}</span>
    </div>

    <div ref="stage" class="kd-stage flex-grow-1 d-flex align-center justify-center">
      <v-progress-circular v-if="!ready && !failed" indeterminate color="primary" />
      <v-alert v-if="failed" type="error" variant="tonal" class="ma-4">
        {{ t('kerneldef.loadFailed') }}：{{ failed }}
      </v-alert>
      <canvas ref="cv" class="kd-canvas" :aria-label="t('kerneldef.title')" />
    </div>

    <v-dialog v-model="resetOpen" max-width="440" @after-leave="giveBackFocus">
      <v-card :title="t('kerneldef.reset.title')" class="pa-2">
        <v-card-text>{{ t('kerneldef.reset.body') }}</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="resetOpen = false">{{ t('kerneldef.reset.cancel') }}</v-btn>
          <v-btn color="error" variant="tonal" :loading="resetting" @click="resetData">
            {{ t('kerneldef.reset.confirm') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.kd-stage {
  position: relative;
  min-height: 0;
}

.kd-canvas {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  border-radius: 12px;
  box-shadow: 0 0 24px rgba(0, 0, 0, 0.55);
  max-width: 100%;
  max-height: 100%;
  background: #05070c;
  outline: none;
}

.kd-canvas:focus-visible {
  box-shadow:
    0 0 0 2px rgb(var(--v-theme-primary)),
    0 0 24px rgba(0, 0, 0, 0.55);
}

.kd-chip {
  padding-block: 4px;
  min-height: 24px;
}

.kd-btn-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.kd-cost {
  opacity: 0.75;
  font-size: 12px;
}

.kd-key {
  opacity: 0.5;
  font-size: 11px;
  border: 1px solid currentColor;
  border-radius: 4px;
  padding: 0 4px;
  line-height: 14px;
}

.kd-selected {
  padding: 4px 10px;
  min-height: 41px;
  border-radius: 10px;
  background: rgba(var(--v-theme-surface-variant), 0.35);
}
</style>
