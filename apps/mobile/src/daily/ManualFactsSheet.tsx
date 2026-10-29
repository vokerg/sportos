import React from 'react';
import {Modal,Pressable,ScrollView,StyleSheet,Switch,Text,TextInput,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useSportosTheme} from '../ui/theme';
import {factFields,type FactField,type useDayActions} from './day-actions';

const groups:Array<{title:string;fields:FactField[]}>= [
 {title:'DAILY FACTS',fields:['steps','workoutPoints','bonusPoints']},
 {title:'DISTANCE',fields:['runOutdoorM','bikeOutdoorM','swimM']},
];
const additional:FactField[]=['runIndoorM','runUnspecifiedM','bikeIndoorM','bikeUnspecifiedM'];
export function ManualFactsSheet({actions:a,date}:{actions:ReturnType<typeof useDayActions>;date:string}){
 const {palette}=useSportosTheme();
 const [more,setMore]=React.useState(false);
 const close=()=>{if(!a.busy)a.setEditor(null)};
 const field=(key:FactField,index:number)=>{
  const [,fullLabel,scale]=factFields.find(([name])=>name===key)!;
  const label=key==='steps'?(a.editor?.totalSteps?'All-day steps':'Steps excluding runs'):fullLabel.replace(/ \((km|m)\)$/,'');
  const unit=scale===1000?'km':key==='swimM'?'m':key.endsWith('Points')?'pt':'';
  return <View key={key} style={[styles.field,{borderColor:palette.border,borderTopWidth:index?StyleSheet.hairlineWidth:0}]}>
   <Text style={[styles.fieldLabel,{color:palette.text}]}>{label}</Text>
   <View style={styles.inputGroup}>
    <TextInput accessibilityLabel={key==='steps'&&a.editor?.totalSteps?'All-day steps':fullLabel} value={a.editor?.draft[key]??''} editable={!a.busy}
     keyboardType="decimal-pad" selectTextOnFocus maxLength={18} returnKeyType="done"
     style={[styles.input,{color:palette.text}]} onChangeText={value=>a.setEditor(current=>current?{...current,draft:{...current.draft,[key]:value}}:null)}/>
    {unit?<Text style={{color:palette.muted,fontSize:14}}>{unit}</Text>:null}
   </View>
  </View>;
 };
 return <Modal visible={!!a.editor} animationType="slide" presentationStyle="pageSheet" allowSwipeDismissal={!a.busy} onRequestClose={close} onDismiss={()=>setMore(false)}>
  <SafeAreaView edges={['top','left','right','bottom']} style={{flex:1,backgroundColor:palette.background}}>
   <View style={[styles.toolbar,{borderColor:palette.border}]}>
    <Pressable accessibilityRole="button" accessibilityLabel="Cancel manual entry" disabled={a.busy} onPress={close} style={styles.toolbarButton}><Text style={{color:palette.accent,fontSize:17,opacity:a.busy?0.4:1}}>Cancel</Text></Pressable>
    <Text accessibilityRole="header" style={{color:palette.text,fontSize:17,fontWeight:'600'}}>Edit day</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="Save manual facts" disabled={a.busy} onPress={a.save} style={styles.toolbarButton}><Text style={{color:palette.accent,fontSize:17,fontWeight:'700',opacity:a.busy?0.4:1}}>{a.busy?'Saving…':'Save'}</Text></Pressable>
   </View>
   <ScrollView automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
    <Text style={{color:palette.muted,fontSize:14}}>{date} · Manual entry</Text>
    {groups.map(group=><View key={group.title} style={styles.group}>
     <Text style={[styles.sectionLabel,{color:palette.muted}]}>{group.title}</Text>
     <View style={[styles.fields,{backgroundColor:palette.surface}]}>{group.fields.map(field)}</View>
     {group.title==='DAILY FACTS'?<>
      <View style={[styles.stepsOption,{backgroundColor:palette.surface}]}>
       <Text style={[styles.fieldLabel,{color:palette.text}]}>Steps include running</Text>
       <Switch accessibilityLabel="Steps include running" value={a.editor?.totalSteps??false} disabled={a.busy} onValueChange={value=>a.setEditor(current=>current?{...current,totalSteps:value}:null)}/>
      </View>
      <Text style={[styles.help,{color:palette.muted}]}>Subtract estimated run steps when enabled. Zero steps or workout points let retained provider evidence supply the value.</Text>
     </>:null}
    </View>)}
    <View style={styles.group}>
     <Pressable accessibilityRole="button" accessibilityState={{expanded:more}} onPress={()=>setMore(value=>!value)} style={[styles.disclosure,{backgroundColor:palette.surface}]}>
      <Text style={{color:palette.accent,fontSize:16,fontWeight:'500'}}>Indoor & other distances</Text><Text style={{color:palette.muted}}>{more?'−':'+'}</Text>
     </Pressable>
     {more?<View style={[styles.fields,{backgroundColor:palette.surface}]}>{additional.map(field)}</View>:null}
    </View>
    <Text style={[styles.help,{color:palette.muted}]}>Saving updates daily totals and score, replacing earlier manual entries. Activities from other sources are preserved. Recalculate later to restore rule-derived bonuses.</Text>
    {a.validation||a.error?<Text accessibilityRole="alert" style={{color:palette.warning,fontSize:14,lineHeight:21}}>{a.validation||a.error}</Text>:null}
   </ScrollView>
  </SafeAreaView>
 </Modal>;
}
const styles=StyleSheet.create({
 toolbar:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:12,minHeight:58,borderBottomWidth:StyleSheet.hairlineWidth},
 toolbarButton:{padding:10,minHeight:44,minWidth:64,justifyContent:'center',alignItems:'center'},
 content:{padding:20,gap:24,paddingBottom:40},group:{gap:8},sectionLabel:{fontSize:11,fontWeight:'600',letterSpacing:1,paddingHorizontal:12},
 fields:{borderRadius:16,paddingHorizontal:16,overflow:'hidden'},field:{flexDirection:'row',flexWrap:'wrap',alignItems:'center',justifyContent:'space-between',gap:8,minHeight:54,paddingVertical:6},
 fieldLabel:{fontSize:16,flexShrink:1},inputGroup:{flexDirection:'row',gap:6,alignItems:'center'},input:{fontSize:17,minWidth:86,minHeight:44,textAlign:'right',fontVariant:['tabular-nums']},
 stepsOption:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12,padding:14,borderRadius:16},help:{fontSize:12,lineHeight:18,paddingHorizontal:12},
 disclosure:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',gap:12,minHeight:52,padding:16,borderRadius:16},
});
