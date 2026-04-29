from django.contrib import admin
from .models import UserProfile, Bet


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = ['nickname', 'uid', 'balance', 'is_email_verified', 'last_daily_bonus', 'created_at']
    search_fields = ['nickname', 'uid']


@admin.register(Bet)
class BetAdmin(admin.ModelAdmin):
    list_display = ['bet_id', 'user', 'train_number', 'train_id', 'train_route', 'data_partenza', 'amount', 'predicted_delay', 'status', 'win_amount']
    list_filter = ['status']
    search_fields = ['train_number', 'user__nickname']
