// Проверочная схема движка (не пример для пользователя). Ожидаемое поведение:
// out — младшие четыре разряда счётчика тактов, меняется на каждом такте;
// на такте 51 (счётчик равен 50) модель вызывает $fatal. Процесс не обрывается:
// модель завершается так же, как по $finish (замечание MODEL_FINISH).
module top (
    input  wire       clk,
    output wire [3:0] out
);
    reg [7:0] cnt = 0;

    always @(posedge clk) begin
        cnt <= cnt + 1'b1;
        if (cnt == 8'd50) $fatal(1, "fatalcheck: счётчик дошёл до 50");
    end

    assign out = cnt[3:0];
endmodule
