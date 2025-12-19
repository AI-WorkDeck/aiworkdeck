<script>
export default {
  onLaunch: function () {
    console.log('App Launch')
  },
  onShow: function () {
    console.log('App Show')
  },
  onHide: function () {
    console.log('App Hide')
  },
}
</script>

<style>
/* King IDE Global Overrides */
/* uni.showModal Style Override (Web/H5) */
uni-modal .uni-modal {
    border-radius: 12px;
    box-shadow: 0 12px 32px rgba(18, 52, 77, 0.16);
    overflow: hidden;
}

uni-modal .uni-modal__title {
    font-size: 18px;
    font-weight: 600;
    color: #1A5336; /* King Forest */
    padding-top: 24px;
}

uni-modal .uni-modal__content {
    font-size: 15px;
    color: #6C757D;
    padding-bottom: 24px;
}

uni-modal .uni-modal__ft {
    border-top: 1px solid #E9ECEF;
}

uni-modal .uni-modal__btn {
    font-size: 16px;
    font-weight: 500;
}

/* Cancel Button */
uni-modal .uni-modal__btn_default {
    color: #6C757D !important;
}

/* Confirm Button */
uni-modal .uni-modal__btn_primary {
    color: #5BD197 !important; /* King Mint */
    font-weight: 600;
}

/* Toast Override */
uni-toast .uni-toast {
   background: rgba(26, 83, 54, 0.9);
   border-radius: 8px;
}
uni-toast .uni-toast__content {
    color: #fff;
}
</style>
