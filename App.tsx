import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AnalysisStackParamList, RootTabParamList } from './src/navigation/types';
import { AccountScreen } from './src/screens/AccountScreen';
import { AnalysisScreen } from './src/screens/AnalysisScreen';
import { DetailScreen } from './src/screens/DetailScreen';
import { HistoryScreen } from './src/screens/HistoryScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { ScanScreen } from './src/screens/ScanScreen';
import { WatchlistScreen } from './src/screens/WatchlistScreen';

const Tab = createBottomTabNavigator<RootTabParamList>();
const AnalysisStack = createNativeStackNavigator<AnalysisStackParamList>();

const headerStyle = { backgroundColor: '#F8FAFC' };

/** 分析タブの中に既存の3画面を入れ子にする(消さずに残す)。 */
function AnalysisNavigator() {
  return (
    <AnalysisStack.Navigator screenOptions={{ headerStyle, headerShadowVisible: false }}>
      <AnalysisStack.Screen
        name="AnalysisHome"
        component={AnalysisScreen}
        options={{ title: '分析' }}
      />
      <AnalysisStack.Screen
        name="Watchlist"
        component={WatchlistScreen}
        options={{ headerShown: false }}
      />
      <AnalysisStack.Screen name="Detail" component={DetailScreen} options={{ title: '' }} />
      <AnalysisStack.Screen name="Scan" component={ScanScreen} options={{ title: '' }} />
    </AnalysisStack.Navigator>
  );
}

/** アイコン画像は持たないので、絵文字と文字だけで区別する。 */
function tabIcon(emoji: string) {
  return ({ color }: { color: string }) => (
    <Text style={{ fontSize: 18, color }}>{emoji}</Text>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Tab.Navigator
          screenOptions={{
            headerStyle,
            headerShadowVisible: false,
            tabBarActiveTintColor: '#2563EB',
            tabBarInactiveTintColor: '#94A3B8',
            tabBarStyle: { backgroundColor: '#FFFFFF', borderTopColor: '#E2E8F0' },
            tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
          }}
        >
          <Tab.Screen
            name="HomeTab"
            component={HomeScreen}
            options={{ title: 'ホーム', headerShown: false, tabBarIcon: tabIcon('🧭') }}
          />
          <Tab.Screen
            name="HistoryTab"
            component={HistoryScreen}
            options={{ title: '履歴', tabBarIcon: tabIcon('📋') }}
          />
          <Tab.Screen
            name="AccountTab"
            component={AccountScreen}
            options={{ title: '資金', tabBarIcon: tabIcon('💰') }}
          />
          <Tab.Screen
            name="AnalysisTab"
            component={AnalysisNavigator}
            options={{ title: '分析', headerShown: false, tabBarIcon: tabIcon('📊') }}
          />
        </Tab.Navigator>
      </NavigationContainer>
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}
