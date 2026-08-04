import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootStackParamList } from './src/navigation/types';
import { DetailScreen } from './src/screens/DetailScreen';
import { WatchlistScreen } from './src/screens/WatchlistScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Stack.Navigator
          screenOptions={{
            headerStyle: { backgroundColor: '#F8FAFC' },
            headerShadowVisible: false,
          }}
        >
          <Stack.Screen
            name="Watchlist"
            component={WatchlistScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen name="Detail" component={DetailScreen} options={{ title: '' }} />
        </Stack.Navigator>
      </NavigationContainer>
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}
