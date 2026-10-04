Component({
  properties: {
    message: { type: String, value: '' },
    title: { type: String, value: '' },
    action: { type: String, value: '' },
  },
  methods: {
    tapAction() {
      this.triggerEvent('action');
    },
  },
});
