<template>
  <view class="tdesign-feedback-host">
    <t-toast id="t-toast" />
    <t-dialog id="t-dialog" />
    <t-action-sheet
      id="t-action-sheet"
      @selected="onActionSheetSelected"
      @cancel="onActionSheetCancel"
      @close="onActionSheetClose"
    />
  </view>
</template>

<script>
import {
  handleActionSheetCancel,
  handleActionSheetClose,
  handleActionSheetSelected
} from "../utils/tdesignFeedback";

export default {
  methods: {
    onActionSheetSelected(event) {
      handleActionSheetSelected(event.detail || {});
    },
    onActionSheetCancel() {
      handleActionSheetCancel();
    },
    onActionSheetClose() {
      handleActionSheetClose();
    }
  }
};
</script>

<style scoped>
.tdesign-feedback-host {
  height: 0;
}
</style>
