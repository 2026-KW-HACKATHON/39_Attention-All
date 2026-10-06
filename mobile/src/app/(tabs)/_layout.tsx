import { Pressable, View } from 'react-native';
import { Tabs, type BottomTabBarProps } from 'expo-router/js-tabs';
import { color, space } from '../../theme';
import { Icon, Txt } from '../../ui';

// 홈 / 지도 / 우리 우이천(가운데 원형) / 기록 / 마이 — 웹 .tabbar와 같은 비율(1:1:1.3:1:1)
const TABS: Record<string, { label: string; icon: string }> = {
  index: { label: '홈', icon: 'home' },
  map: { label: '지도', icon: 'map' },
  river: { label: '우리 우이천', icon: 'river' },
  records: { label: '기록', icon: 'records' },
  my: { label: '마이', icon: 'user' },
};

export default function TabsLayout() {
  return (
    <Tabs tabBar={props => <TabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="map" />
      <Tabs.Screen name="river" />
      <Tabs.Screen name="records" />
      <Tabs.Screen name="my" />
    </Tabs>
  );
}

function TabBar({ state, navigation, insets }: BottomTabBarProps) {
  return (
    <View style={{ flexDirection: 'row', height: space.tabH + insets.bottom, paddingBottom: insets.bottom, backgroundColor: color.panel, borderTopWidth: 1, borderTopColor: color.line }}>
      {state.routes.map((route, i) => {
        const t = TABS[route.name], on = state.index === i, center = route.name === 'river';
        const press = () => {
          const e = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!on && !e.defaultPrevented) navigation.navigate(route.name);
        };
        return (
          <Pressable key={route.key} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={t.label} onPress={press} style={{ flex: center ? 1.3 : 1, alignItems: 'center', justifyContent: center ? 'flex-end' : 'center', gap: 4, paddingBottom: center ? 5 : 0 }}>
            {center ? (
              // 원형 버튼은 탭 막대 위로 14px 올라오고 4px 흰 테두리로 막대 선을 가린다(웹 .tc-circle). 선택되면 블루로 채운다.
              <View style={{ position: 'absolute', top: -18, width: 64, height: 64, borderRadius: 32, backgroundColor: color.panel, alignItems: 'center', justifyContent: 'center' }}>
                <View
                  style={[
                    { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? color.blue : color.panel, borderWidth: on ? 0 : 2, borderColor: color.blue },
                    on && { elevation: 6, shadowColor: color.blue, shadowOpacity: 0.35, shadowRadius: 6, shadowOffset: { width: 0, height: 4 } },
                  ]}>
                  <Icon name={t.icon} s={28} w={1.9} c={on ? color.white : color.blue} />
                </View>
              </View>
            ) : (
              <Icon name={t.icon} s={24} w={on ? 2.3 : 1.8} c={on ? color.blue : color.sub} />
            )}
            <Txt w={on ? 700 : 600} s={12} c={on ? color.blue : color.sub} lh={1.3} lines={1} fit>
              {t.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}
