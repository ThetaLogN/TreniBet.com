from rest_framework import serializers
from .models import UserProfile, Bet


class UserProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = UserProfile
        fields = ['uid', 'nickname', 'balance', 'is_email_verified', 'created_at']
        read_only_fields = ['created_at']


class BetSerializer(serializers.ModelSerializer):
    class Meta:
        model = Bet
        fields = [
            'bet_id', 'train_id', 'train_number', 'train_route',
            'predicted_delay', 'amount', 'odds',
            'station_code', 'data_partenza',
            'scheduled_departure', 'scheduled_arrival',
            'status', 'actual_delay', 'win_amount',
            'placed_at', 'resolved_at',
        ]
        read_only_fields = ['status', 'actual_delay', 'win_amount', 'resolved_at']


class LeaderboardSerializer(serializers.ModelSerializer):
    class Meta:
        model = UserProfile
        fields = ['uid', 'nickname', 'balance']
