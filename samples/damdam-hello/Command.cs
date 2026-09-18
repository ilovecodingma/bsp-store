// DamDam — 리빗에서 알림창 하나 띄우는 맛보기 애드인.
//   스토어 -> 런처 -> 리빗 Addins 로 들어가는 길이 되는지 보려고 만든 것.
//   리빗에서 : 추가 기능 탭 > 외부 도구 > DamDam Hello

using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace DamDamHello
{
    [Transaction(TransactionMode.ReadOnly)]
    [Regeneration(RegenerationOption.Manual)]
    public class Command : IExternalCommand
    {
        public Result Execute(ExternalCommandData data, ref string message, ElementSet elements)
        {
            var uiapp = data.Application;
            var doc = uiapp.ActiveUIDocument != null ? uiapp.ActiveUIDocument.Document : null;

            var td = new TaskDialog("DamDam")
            {
                MainInstruction = "Hello World",
                MainContent = "DamDam 애드인이 리빗에 들어와 있습니다.\n\n" +
                              "리빗 " + uiapp.Application.VersionNumber +
                              (doc != null ? "\n열린 문서 : " + doc.Title : "\n열린 문서 없음"),
                CommonButtons = TaskDialogCommonButtons.Close,
                MainIcon = TaskDialogIcon.TaskDialogIconInformation
            };
            td.Show();
            return Result.Succeeded;
        }
    }
}
