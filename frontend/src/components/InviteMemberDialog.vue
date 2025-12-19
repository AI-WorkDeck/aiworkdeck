<template>
  <view v-if="visible" class="king-dialog-mask" @tap="close">
    <view class="king-dialog" @tap.stop>
      <view class="king-dialog-header">
        <text class="king-dialog-title">邀请成员</text>
        <view class="modal-close" @tap="close">×</view>
      </view>

      <!-- Tabs -->
      <view class="dialog-tabs">
        <view 
          class="dialog-tab" 
          :class="{ active: activeTab === 'MEMBER' }"
          @tap="activeTab = 'MEMBER'"
        >
          内部成员
        </view>
        <view 
          class="dialog-tab" 
          :class="{ active: activeTab === 'CLIENT' }"
          @tap="activeTab = 'CLIENT'"
        >
          外部客户
        </view>
        <!-- Border bottom line -->
        <view class="tab-line" :style="{ left: activeTab === 'MEMBER' ? '0%' : '50%' }"></view>
      </view>

      <view class="king-dialog-body">
        <!-- Internal Member Form -->
        <view v-if="activeTab === 'MEMBER'">
          <view class="form-group">
            <text class="form-label">用户名</text>
            <input 
              class="king-input" 
              v-model="memberForm.username" 
              placeholder="请输入对方用户名" 
              :focus="activeTab === 'MEMBER'"
            />
          </view>
          <view class="form-group">
            <text class="form-label">角色</text>
            <view class="role-options">
               <view 
                 class="role-option" 
                 :class="{ active: memberForm.role === 'ADMIN' }"
                 @tap="memberForm.role = 'ADMIN'"
               >
                 <view class="role-dot"></view>
                 <text>管理员</text>
               </view>
               <view 
                 class="role-option" 
                 :class="{ active: memberForm.role === 'PARTICIPANT' }"
                 @tap="memberForm.role = 'PARTICIPANT'"
               >
                 <view class="role-dot"></view>
                 <text>参与者</text>
               </view>
               <view 
                 class="role-option" 
                 :class="{ active: memberForm.role === 'READ_ONLY' }"
                 @tap="memberForm.role = 'READ_ONLY'"
               >
                 <view class="role-dot"></view>
                 <text>只读</text>
               </view>
            </view>
          </view>
        </view>

        <!-- External Client Form -->
        <view v-else>
           <view class="invite-desc-box">
             <text class="invite-desc">生成一个访问码，客户凭此码即可登录并上传尽调文件。</text>
           </view>
           
           <view v-if="!clientInviteCode">
               <view class="form-group">
                 <text class="form-label">客户名称</text>
                 <input 
                   class="king-input" 
                   v-model="clientName" 
                   placeholder="请输入客户名称（可选）" 
                 />
               </view>
           </view>

           <view v-else class="code-result-box">
               <text class="code-label">访问码已生成：</text>
               <view class="code-display-row">
                   <text class="code-text">{{ clientInviteCode }}</text>
                   <text class="copy-link" @tap="copyClientCode">复制</text>
               </view>
           </view>
        </view>
      </view>

      <view class="king-dialog-footer">
        <view class="king-btn king-btn-secondary" @tap="close">取消</view>
        
        <block v-if="activeTab === 'MEMBER'">
            <view class="king-btn king-btn-primary" @tap="submitMemberInvite" :class="{ disabled: loading }">
                {{ loading ? '邀请中...' : '确认邀请' }}
            </view>
        </block>
        <block v-else>
            <view v-if="!clientInviteCode" class="king-btn king-btn-primary" @tap="generateClientCode" :class="{ disabled: loading }">
                {{ loading ? '生成...' : '生成访问码' }}
            </view>
            <view v-else class="king-btn king-btn-primary" @tap="close">完成</view>
        </block>
      </view>
    </view>
  </view>
</template>

<script>
import { addProjectMember, inviteClient } from '@/services/api.js'

export default {
  name: 'InviteMemberDialog',
  props: {
    visible: {
      type: Boolean,
      default: false
    },
    projectId: {
      type: [Number, String],
      required: true
    }
  },
  data() {
    return {
      activeTab: 'MEMBER', // 'MEMBER' | 'CLIENT'
      memberForm: {
        username: '',
        role: 'PARTICIPANT'
      },
      clientName: '',
      clientInviteCode: '',
      loading: false
    }
  },
  watch: {
    visible(val) {
      if (val) {
        // Reset state on open
        this.activeTab = 'MEMBER'
        this.memberForm = { username: '', role: 'PARTICIPANT' }
        this.clientName = ''
        this.clientInviteCode = ''
        this.loading = false
      }
    }
  },
  methods: {
    close() {
      this.$emit('update:visible', false)
      this.$emit('close')
    },
    async submitMemberInvite() {
       if (!this.memberForm.username) {
         uni.showToast({ title: '请输入用户名', icon: 'none' })
         return
       }
       this.loading = true
       try {
         await addProjectMember(this.projectId, this.memberForm.username, this.memberForm.role)
         uni.showToast({ title: '邀请成功', icon: 'success' })
         this.$emit('success')
         this.close()
       } catch (e) {
         uni.showToast({ title: e.message || '邀请失败', icon: 'none' })
       } finally {
         this.loading = false
       }
    },
    async generateClientCode() {
        this.loading = true
        try {
            const res = await inviteClient(this.projectId, this.clientName)
            if (res.code === 0 && res.data && res.data.accessCode) {
                this.clientInviteCode = res.data.accessCode
            } else {
                throw new Error('生成失败')
            }
        } catch (e) {
            uni.showToast({ title: e.message || '生成失败', icon: 'none' })
        } finally {
            this.loading = false
        }
    },
    copyClientCode() {
        if (!this.clientInviteCode) return
        uni.setClipboardData({
            data: this.clientInviteCode,
            success: () => {
                uni.showToast({ title: '复制成功', icon: 'success' })
            }
        })
    }
  }
}
</script>

<style scoped>
/* Copied King Dialog Styles + Specifics */
.king-dialog-mask {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background-color: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  backdrop-filter: blur(2px);
}

.king-dialog {
  width: 618px; /* Golden Ratio */
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-sizing: border-box;
}

.king-dialog-header {
  padding: 24px 32px 0;
  position: relative;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.king-dialog-title {
  font-size: 20px;
  font-weight: 600;
  color: #0f172a;
}

.modal-close {
  font-size: 24px;
  color: #94a3b8;
  cursor: pointer;
  line-height: 1;
  padding: 4px;
}

.modal-close:hover {
  color: #0f172a;
}

/* Tabs */
.dialog-tabs {
  display: flex;
  position: relative;
  border-bottom: 1px solid #e2e8f0;
  margin-top: 16px;
}

.dialog-tab {
  flex: 1;
  text-align: center;
  padding: 12px 0;
  font-size: 15px;
  color: #64748b;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.2s;
}

.dialog-tab:hover {
  color: #1A5336;
  background: #f8fafc;
}

.dialog-tab.active {
  color: #1A5336;
  font-weight: 600;
}

.tab-line {
  position: absolute;
  bottom: 0;
  height: 2px;
  background: #1A5336;
  width: 50%;
  transition: left 0.3s ease;
}

.king-dialog-body {
  padding: 24px 32px;
  min-height: 200px;
}

.form-group {
  margin-bottom: 20px;
}

.form-label {
  display: block;
  font-size: 14px;
  font-weight: 500;
  color: #334155;
  margin-bottom: 8px;
}

.king-input {
  width: 100%;
  height: 44px;
  padding: 0 12px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  font-size: 14px;
  color: #0f172a;
  transition: all 0.2s;
  box-sizing: border-box;
}

.king-input:focus {
  border-color: #1A5336;
  outline: none;
  box-shadow: 0 0 0 3px rgba(26, 83, 54, 0.1);
}

/* Role Options */
.role-options {
  display: flex;
  gap: 16px;
}

.role-option {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  padding: 6px 12px;
  border-radius: 20px;
  border: 1px solid #e2e8f0;
  font-size: 13px;
  color: #475569;
  transition: all 0.2s;
}

.role-option:hover {
  border-color: #cbd5e1;
  background: #f8fafc;
}

.role-option.active {
  border-color: #1A5336;
  background: #F0FDF4;
  color: #1A5336;
}

.role-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1px solid #cbd5e1;
  background: #fff;
  position: relative;
}

.role-option.active .role-dot {
  border-color: #1A5336;
  background: #1A5336;
}

.role-option.active .role-dot::after {
  content: '';
  position: absolute;
  top: 4px; left: 4px; right: 4px; bottom: 4px;
  background: #fff;
  border-radius: 50%;
}

/* Client Invite */
.invite-desc-box {
  background: #f8fafc;
  padding: 12px;
  border-radius: 8px;
  margin-bottom: 20px;
}

.invite-desc {
  font-size: 13px;
  color: #64748b;
  line-height: 1.5;
}

.code-result-box {
  text-align: center;
  padding: 20px 0;
}

.code-label {
  font-size: 14px;
  color: #64748b;
  margin-bottom: 8px;
  display: block;
}

.code-display-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
}

.code-text {
  font-family: monospace;
  font-size: 24px;
  color: #0f172a;
  letter-spacing: 2px;
  background: #f1f5f9;
  padding: 4px 12px;
  border-radius: 6px;
}

.copy-link {
  color: #1A5336;
  font-size: 14px;
  cursor: pointer;
  text-decoration: underline;
}

.king-dialog-footer {
  padding: 20px 32px 24px;
  background: #f8fafc;
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  border-top: 1px solid #f1f5f9;
}

.king-btn {
  height: 40px;
  padding: 0 24px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.king-btn-primary {
  background: #1A5336;
  color: #ffffff;
  border: 1px solid transparent;
}

.king-btn-primary:hover {
  background: #14422b;
}

.king-btn-primary.disabled {
  background: #94a3b8;
  cursor: not-allowed;
}

.king-btn-secondary {
  background: #ffffff;
  color: #475569;
  border: 1px solid #cbd5e1;
}

.king-btn-secondary:hover {
  background: #f1f5f9;
  border-color: #94a3b8;
  color: #1e293b;
}
</style>
