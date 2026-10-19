/**
 * 布尔状态切换（实用示例）。
 *
 * 演示 app/composables/ 的自动导入机制：定义后无需 import，
 * 即可在任意组件的 <script setup> 中直接调用。
 */
export function useToggle(initial = false) {
	const state = ref(initial)

	function toggle() {
		state.value = !state.value
	}

	function set(value: boolean) {
		state.value = value
	}

	return {
		state,
		toggle,
		set,
	}
}
