<script setup lang="ts">
/**
 * Player 前台根元件。
 * 提供統一的版面骨架（header + 路由出口），實際畫面由各 view 渲染。
 */
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <header class="bg-ffxiv-panel border-b border-ffxiv-accent/30 px-6 py-3 flex items-center">
      <h1 class="text-xl font-bold text-ffxiv-accent">FFXIV 機制模擬練習器</h1>
    </header>
    <main class="flex-1">
      <RouterView />
    </main>
  </div>
</template>
